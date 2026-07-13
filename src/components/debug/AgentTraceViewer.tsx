'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { AgentTraceRow } from '@/lib/supabase/types';
import { formatKstTime } from '@/lib/time';
import { useSimStore } from '@/store/simulationStore';
import { useDebugStore } from '@/store/debugStore';
import { loadLocalTraces, parseBundle, redact, TRACE_BUNDLE_SCHEMA, type TraceBundle } from '@/lib/debug/traceCorrelation';

type State = 'idle'|'loading'|'ready'|'error'|'unavailable';
interface Props { refreshKey?: number|null }
interface Anomaly { signature:string; message:string; hint:string }
const LIMIT=100;
const BAD=/failed|changes_requested|needs_more_info|needs_more_testing|rejected|error/i;
const SENSITIVE=/api|auth|credential|key|password|secret|token/i;

function badge(t:string){return t==='llm_call'?'trace-badge--llm':t==='handoff'?'trace-badge--handoff':t==='decision'?'trace-badge--decision':t==='tool_use'?'trace-badge--tool':'trace-badge--unknown'}
function taskTitle(t:AgentTraceRow){const v=t.metadata?.task_title;return typeof v==='string'?v:null}
function summarize(m:AgentTraceRow['metadata']){if(!m)return 'metadata —';return Object.entries(m).filter(([k])=>!SENSITIVE.test(k)).slice(0,4).map(([k,v])=>`${k}: ${typeof v==='object'?'[…]':String(v).slice(0,45)}`).join(' · ')||'metadata redacted'}
function anomalies(ts:AgentTraceRow[], debugTrace:boolean|null):Anomaly[]{
 const out:Anomaly[]=[]; const add=(signature:string,message:string,hint:string)=>{if(!out.some(x=>x.signature===signature))out.push({signature,message,hint})};
 if(debugTrace===false)add('trace-not-recorded','최근 Agent 호출의 traceRecorded가 false입니다.','Supabase RLS/service role 설정과 agent_traces insert 응답을 확인하세요.');
 ts.forEach((t,i)=>{if((t.latency_ms??0)>=10000)add(`slow:${t.id}`,`${t.agent_id} 호출 지연이 ${t.latency_ms}ms입니다.`,'timeout, 모델 응답 크기, 네트워크 상태를 확인하세요.');
  if(t.metadata?.traceRecorded===false)add(`trace:${t.id}`,`${t.agent_id} 응답이 traceRecorded=false입니다.`,'agent_traces 권한과 서버 trace recorder를 확인하세요.');
  if(t.trace_type==='tool_use'&&t.metadata?.action==='ask_agent'){const hasCall=ts.slice(0,i).some(x=>x.trace_type==='llm_call'&&x.agent_id===t.agent_id);if(!hasCall)add(`ask:${t.id}`,`Ask ${t.agent_id} 호출 뒤 llm_call trace가 없습니다.`,'API route 응답과 trace insert 경로를 확인하세요.');}
  const st=t.metadata?.finalStatus??t.metadata?.approvalStatus;if(typeof st==='string'&&BAD.test(st))add(`status:${t.id}`,`${t.agent_id} 결과가 실패 계열 상태(${st})입니다.`,'관련 task를 reviewer/qa로 재검증하세요.');
  if(t.trace_type==='handoff'){const target=String(t.metadata?.target_agent??'');const later=ts.slice(0,i).some(x=>x.trace_type==='decision'&&(!target||x.agent_id===target));if(!later)add(`handoff:${t.id}`,`${target||'target'} handoff 뒤 decision trace가 없습니다.`,'담당 agent workflow 시작 및 decision 기록을 확인하세요.');}
 });
 return out;
}

export default function AgentTraceViewer({refreshKey=null}:Props){
 const [collapsed,setCollapsed]=useState(false),[status,setStatus]=useState<State>('idle');
 const [traces,setTraces]=useState<AgentTraceRow[]>([]),[selected,setSelected]=useState(''),[error,setError]=useState<string|null>(null),[imported,setImported]=useState<TraceBundle|null>(null);
 const fileRef=useRef<HTMLInputElement>(null); const tasks=useSimStore(s=>s.tasks),events=useSimStore(s=>s.events),agents=useSimStore(s=>s.agents);
 const debugTrace=useDebugStore(s=>s.planner.traceRecorded),highlight=useDebugStore(s=>s.setHighlightedTaskTitle);
 const lens=useDebugStore(s=>s.lens);
 const load=useCallback(async()=>{setStatus('loading');setError(null);const local=loadLocalTraces();const db=getSupabaseClient();if(!db){setTraces(local);setStatus('unavailable');return;}const {data,error:e}=await db.from('agent_traces').select('id,session_id,agent_id,trace_type,input_tokens,output_tokens,latency_ms,model,metadata,created_at').order('created_at',{ascending:false}).limit(LIMIT);if(e){console.warn('[Supabase] trace query failed:',e.message);setTraces(local);setError('Supabase trace query failed; showing local traces.');setStatus('error');return;}const merged=[...(data??[]) as AgentTraceRow[],...local].filter((x,i,a)=>a.findIndex(y=>y.id===x.id)===i).slice(0,LIMIT);setTraces(merged);setStatus('ready');},[]);
 useEffect(()=>{const timer=window.setTimeout(()=>void load(),0);const h=()=>void load();window.addEventListener('agent-office-traces-changed',h);return()=>{window.clearTimeout(timer);window.removeEventListener('agent-office-traces-changed',h)}},[load,refreshKey]);
 const active=imported?.traces??traces; const keyword=lens.keyword.trim().toLowerCase(); const filtered=active.filter(t=>(!lens.role||t.agent_id===lens.role)&&(!lens.traceType||t.trace_type===lens.traceType)&&(!lens.sessionId||(t.session_id||'').includes(lens.sessionId))&&(!keyword||JSON.stringify(t.metadata??{}).toLowerCase().includes(keyword))); const groups=filtered.reduce<Record<string,AgentTraceRow[]>>((acc,t)=>{const key=t.session_id||'unknown';(acc[key]??=[]).push(t);return acc},{}); const sessions=Object.keys(groups); const sid=imported?.sessionId||selected||sessions[0]||''; const current=groups[sid]??[]; const issues=anomalies(current,imported?null:debugTrace); const titles=[...new Set(current.map(taskTitle).filter((x):x is string=>!!x))];
 const matchedTitle=titles.find(title=>tasks.some(t=>t.title===title))??null;
 useEffect(()=>{highlight(matchedTitle);return()=>highlight(null)},[matchedTitle,highlight]);
 function createFinding(){if(imported||!issues[0])return;const sig=`${sid}:${issues.map(x=>x.signature).join('|')}`;const key=`trace-finding:${sig}`;if(localStorage.getItem(key)){setError('이 session/anomaly finding은 이미 생성되었습니다.');return;}const role=issues.some(x=>x.signature.startsWith('status:'))?'qa':'reviewer';useSimStore.getState().addLocalTask({title:`Trace finding ${sid.slice(0,8)}`,description:`[local-only] ${issues[0].message}`,assignedTo:role,status:'backlog',priority:'high'});useSimStore.getState().addEvent({agentId:role,agentName:agents[role].name,agentColor:agents[role].primaryColor,type:'review',message:`[${agents[role].name}] Debug finding 생성: ${issues[0].message}`});localStorage.setItem(key,'1');}
 function exportBundle(){const bundle=redact({schemaVersion:TRACE_BUNDLE_SCHEMA,exportedAt:new Date().toISOString(),sessionId:sid,traces:current}) as TraceBundle;const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(bundle,null,2)],{type:'application/json'}));a.download=`trace-${sid.slice(0,12)||'session'}.json`;a.click();URL.revokeObjectURL(a.href);}
 async function importBundle(file?:File){if(!file)return;try{setImported(parseBundle(await file.text()));setError(null);}catch(e){setImported(null);setError(e instanceof Error?e.message:'Invalid bundle.');}}
 return <section className={`trace-viewer${collapsed?' trace-viewer--collapsed':''}`}>
  <div className="trace-viewer-header"><button className="trace-viewer-toggle" onClick={()=>setCollapsed(!collapsed)}><span>TRACE CORRELATION DEBUGGER</span><strong>{filtered.length}/{active.length}</strong></button><button className="trace-refresh-btn" onClick={()=>void load()}>REFRESH</button></div>
  {!collapsed&&<div className="trace-viewer-body">
   <div className="trace-viewer-meta"><span>{imported?'READ-ONLY IMPORT':status}</span><span>{sessions.length} sessions</span></div>
   {error&&<div className="trace-message trace-message--error">{error}</div>}
   <div className="trace-tools"><select value={sid} disabled={!!imported} onChange={e=>setSelected(e.target.value)}>{sessions.map(s=><option key={s} value={s}>{s.slice(0,18)} ({groups[s]?.length})</option>)}</select><button onClick={exportBundle} disabled={!sid}>EXPORT</button><button onClick={()=>fileRef.current?.click()}>IMPORT</button>{imported&&<button onClick={()=>setImported(null)}>EXIT IMPORT</button>}<input ref={fileRef} hidden type="file" accept="application/json" onChange={e=>void importBundle(e.target.files?.[0])}/></div>
   <div className="trace-context"><b>Tasks</b> {titles.length?titles.join(' · '):'—'}<br/><b>Events</b> {events.filter(e=>titles.some(t=>e.message.includes(t))).slice(0,3).map(e=>e.message).join(' · ')||'—'}<br/><b>Agents</b> {[...new Set(current.map(t=>t.agent_id))].map(id=>`${id}:${agents[id as keyof typeof agents]?.status??'unknown'}`).join(' · ')||'—'}</div>
   {issues.length>0&&<div className="trace-anomalies"><b>ANOMALIES ({issues.length})</b>{issues.map(x=><p key={x.signature}>⚠ {x.message}<small>{x.hint}</small></p>)}<button onClick={createFinding} disabled={!!imported}>Create Debug Finding</button></div>}
   <div className="trace-list">{current.length===0&&<span className="lens-empty">No matching traces. Clear all to reset.</span>}{current.map(t=><article className="trace-card" key={t.id}><div className="trace-card-top"><span className={`trace-badge ${badge(t.trace_type)}`}>{t.trace_type}</span><strong>{t.agent_id}</strong><time>{formatKstTime(t.created_at)} KST</time></div><div className="trace-card-metrics"><span>{t.model??'model —'}</span><span>{t.latency_ms??'—'}ms</span><span>in {t.input_tokens??'—'}</span><span>out {t.output_tokens??'—'}</span></div><p>{summarize(t.metadata)}</p></article>)}</div>
  </div>}
 </section>;
}
