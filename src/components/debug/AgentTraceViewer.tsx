'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import { getSessionId } from '@/lib/supabase/session';
import type { AgentTraceRow } from '@/lib/supabase/types';
import { formatKstTime } from '@/lib/time';
import { useSimStore } from '@/store/simulationStore';
import { useDebugStore } from '@/store/debugStore';
import { highlightParts, taskMatchesLens, traceMatchesLens, useOperationsLens } from '@/store/operationsLensStore';

interface Props { refreshKey?: number | null }
interface Bundle { schemaVersion: 1; exportedAt: string; sessionId: string; traces: AgentTraceRow[] }
interface Anomaly { signature: string; text: string; hint: string; role: 'reviewer'|'qa' }
const LIMIT=100;
const TRACE_TYPES=new Set(['llm_call','handoff','decision','tool_use']);
const SECRET=/api.?key|authorization|bearer|credential|password|secret|service.?role|token/i;
const FAIL=/failed|changes_requested|needs_more|error|rejected/i;

function redact(value: unknown, key=''): unknown {
  if (SECRET.test(key)) return '[REDACTED]';
  if (typeof value==='string' && (SECRET.test(value) || /sk-ant-|bearer\s+|eyJ[A-Za-z0-9_-]+\./i.test(value))) return '[REDACTED]';
  if (Array.isArray(value)) return value.map(v=>redact(v));
  if (value && typeof value==='object') return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,redact(v,k)]));
  return value;
}
function badge(t:string){return t==='llm_call'?'trace-badge--llm':t==='handoff'?'trace-badge--handoff':t==='decision'?'trace-badge--decision':t==='tool_use'?'trace-badge--tool':'trace-badge--unknown'}
function taskTitle(t:AgentTraceRow){const v=t.metadata?.task_title ?? t.metadata?.taskTitle; return typeof v==='string'?v:''}
function anomalies(traces:AgentTraceRow[], lastCall:{traceRecorded:boolean|null;lastPlanAt:number|null}):Anomaly[]{
 const out:Anomaly[]=[]; const add=(signature:string,text:string,hint:string,role:'reviewer'|'qa'='reviewer')=>{if(!out.some(a=>a.signature===signature))out.push({signature,text,hint,role})};
 if(lastCall.traceRecorded===false) add('trace-false','최근 Ask Agent 호출의 trace가 기록되지 않았습니다.','service role key와 agent_traces RLS/로그를 확인하세요.');
 traces.forEach(t=>{if(t.metadata?.traceRecorded===false||t.metadata?.trace_recorded===false)add(`trace-false:${t.id}`,`${t.agent_id} traceRecorded가 false입니다.`,`서버 trace insert 결과와 Supabase 권한을 확인하세요.`);});
 traces.filter(t=>t.trace_type==='handoff'&&t.agent_id==='planner').forEach(h=>{const title=taskTitle(h); if(!traces.some(d=>d.trace_type==='decision'&&taskTitle(d)===title&&new Date(d.created_at)>=new Date(h.created_at))) add(`handoff:${title}`,'handoff 뒤 decision이 없습니다.','담당 agent workflow 시작과 session_id 전달을 확인하세요.');});
 if(lastCall.lastPlanAt && !traces.some(t=>t.trace_type==='llm_call'&&Date.now()-new Date(t.created_at).getTime()<120000)) add('missing-llm','Ask Agent 호출 뒤 llm_call이 보이지 않습니다.','ENABLE_LIVE_LLM, API route, trace insert 결과를 확인하세요.');
 traces.forEach(t=>{if((t.latency_ms??0)>=10000)add(`latency:${t.id}`,`${t.agent_id} 호출 지연이 10초 이상입니다.`,`timeout/model/network 상태를 확인하세요.`,'qa'); const m=t.metadata??{}; for(const k of ['finalStatus','approvalStatus','final_status','approval_status']) if(FAIL.test(String(m[k]??''))) add(`${k}:${t.id}`,`${k}가 실패 계열 값(${String(m[k])})입니다.`,`관련 테스트나 수정 요청을 재검토하세요.`,'qa');});
 return out;
}
function validBundle(value:unknown):value is Bundle{
 if(!value||typeof value!=='object')return false;
 const b=value as Partial<Bundle>;
 if(b.schemaVersion!==1||typeof b.exportedAt!=='string'||!Number.isFinite(Date.parse(b.exportedAt))||typeof b.sessionId!=='string'||!b.sessionId||!Array.isArray(b.traces)||b.traces.length>LIMIT)return false;
 return b.traces.every(t=>Boolean(t&&typeof t==='object'&&typeof t.id==='string'&&t.session_id===b.sessionId&&typeof t.agent_id==='string'&&TRACE_TYPES.has(t.trace_type)&&typeof t.created_at==='string'&&Number.isFinite(Date.parse(t.created_at))&&(t.metadata===null||t.metadata===undefined||(typeof t.metadata==='object'&&!Array.isArray(t.metadata)))));
}

export default function AgentTraceViewer({refreshKey=null}:Props){
 const [traces,setTraces]=useState<AgentTraceRow[]>([]),[selected,setSelected]=useState(''),[error,setError]=useState(''),[imported,setImported]=useState(false);
 const input=useRef<HTMLInputElement>(null); const tasks=useSimStore(s=>s.tasks), events=useSimStore(s=>s.events), agents=useSimStore(s=>s.agents), debug=useDebugStore(s=>s.lastLlm), setHighlight=useDebugStore(s=>s.setHighlightedTaskTitle);
 const localRows=useCallback(()=>{const session=getSessionId();const rows:AgentTraceRow[]=events.slice(-LIMIT).reverse().map(e=>({id:`local-${e.id}`,session_id:session,agent_id:e.agentId,trace_type:e.type==='planning'?'handoff':e.type==='review'?'decision':'tool_use',input_tokens:null,output_tokens:null,latency_ms:null,model:'local',metadata:{task_title:tasks.find(t=>e.message.includes(t.title))?.title??'',local:true},created_at:new Date(e.timestamp).toISOString()}));if(debug.lastPlanAt)rows.unshift({id:`local-llm-${debug.lastPlanAt}`,session_id:session,agent_id:debug.agentId??'planner',trace_type:'llm_call',input_tokens:debug.inputTokens,output_tokens:debug.outputTokens,latency_ms:debug.latencyMs,model:debug.model??debug.provider??'mock',metadata:{task_title:tasks.find(t=>t.assignedTo===debug.agentId)?.title??'',traceRecorded:debug.traceRecorded,local:true},created_at:new Date(debug.lastPlanAt).toISOString()});return rows.slice(0,LIMIT)},[debug,events,tasks]);
 const load=useCallback(async()=>{setImported(false);setError('');const fallback=localRows();const sb=getSupabaseClient();if(!sb){setTraces(fallback);setSelected(s=>s||fallback[0]?.session_id||'');setError('Supabase unavailable — local analysis mode');return;}const {data,error:e}=await sb.from('agent_traces').select('*').order('created_at',{ascending:false}).limit(LIMIT);if(e){setTraces(fallback);setSelected(s=>s||fallback[0]?.session_id||'');setError('Trace query failed — showing local analysis data.');return;}const rows=(data??[]) as AgentTraceRow[];setTraces(rows.length?rows:fallback);setSelected(s=>(rows.length?rows:fallback).some(r=>r.session_id===s)?s:(rows[0]?.session_id??fallback[0]?.session_id??''));},[localRows]);
 useEffect(()=>{const timer=window.setTimeout(()=>{void load()},0);return()=>window.clearTimeout(timer)},[load,refreshKey]);
 const lens=useOperationsLens(s=>s.filters);
 const clearLens=useOperationsLens(s=>s.clear);
 const setLensTraces=useOperationsLens(s=>s.setTraceRows);
 useEffect(()=>{setLensTraces(traces);return()=>setLensTraces([])},[traces,setLensTraces]);
 const sessions=useMemo(()=>[...new Set(traces.map(t=>t.session_id))], [traces]); const selectedTraces=useMemo(()=>traces.filter(t=>t.session_id===selected),[traces,selected]); const current=useMemo(()=>selectedTraces.filter(t=>traceMatchesLens(t,lens,tasks)),[selectedTraces,lens,tasks]); const issues=useMemo(()=>anomalies(selectedTraces,debug),[selectedTraces,debug]);
 useEffect(()=>{const titles=selectedTraces.map(taskTitle).filter(Boolean);const match=tasks.find(t=>titles.includes(t.title));setHighlight(match?.title??null);return()=>setHighlight(null)},[selectedTraces,tasks,setHighlight]);
 function finding(){const a=issues.find(issue=>!tasks.some(t=>t.description.includes(`trace-finding:${selected}:${issue.signature}`)));if(!a)return;const sig=`trace-finding:${selected}:${a.signature}`;useSimStore.getState().addLocalTask({title:`Trace finding: ${a.text.slice(0,24)}`,description:`[local-only] ${sig} ${a.hint}`,assignedTo:a.role,status:'backlog',priority:'high'});useSimStore.getState().addEvent({agentId:a.role,agentName:agents[a.role].name,agentColor:agents[a.role].primaryColor,type:'review',message:`[Local Debug Finding] ${a.text}`});}
 function exportBundle(){const b:Bundle={schemaVersion:1,exportedAt:new Date().toISOString(),sessionId:selected,traces:selectedTraces};const blob=new Blob([JSON.stringify(redact(b),null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`trace-${selected.slice(0,8)||'session'}.json`;a.click();URL.revokeObjectURL(a.href)}
 async function importBundle(file?:File){if(!file)return;try{const x=JSON.parse(await file.text()) as unknown;if(!validBundle(x))throw new Error();const safe=redact(x) as Bundle;setTraces(safe.traces);setSelected(safe.sessionId);setImported(true);setError('Read-only imported bundle');}catch{setError('손상되었거나 지원하지 않는 bundle입니다.');}}
 const related=tasks.filter(t=>selectedTraces.some(x=>taskTitle(x)===t.title));
 const lensWarnings=useMemo(()=>{const out:string[]=[];for(const t of tasks.filter(x=>taskMatchesLens(x,{...lens,traceType:'',sessionId:''},traces))){const linked=traces.filter(x=>taskTitle(x)===t.title);const scoped=linked.filter(x=>(!lens.sessionId||x.session_id===lens.sessionId.trim())&&(!lens.traceType||x.trace_type===lens.traceType));if(!scoped.length)out.push(`Task “${t.title.slice(0,36)}” has no related trace for this lens`);else if(t.assignedTo&&scoped.some(x=>x.agent_id!==t.assignedTo))out.push(`Agent role mismatch: “${t.title.slice(0,36)}”`);if(!events.some(e=>e.message.includes(t.title)))out.push(`Task “${t.title.slice(0,36)}” has no related event`)}if(lens.sessionId&&traces.length&&!traces.some(t=>t.session_id===lens.sessionId.trim()))out.push('sessionId mismatch');return [...new Set(out)].slice(0,6)},[tasks,events,traces,lens]);
 const grouped=useMemo(()=>{const count=(values:string[])=>Object.entries(values.reduce<Record<string,number>>((a,v)=>{a[v||'—']=(a[v||'—']??0)+1;return a},{})).map(([k,v])=>`${k} (${v})`).join(' · ');return {agents:count(current.map(t=>t.agent_id)),types:count(current.map(t=>t.trace_type)),tasks:count(current.map(taskTitle))}},[current]);
 return <section className="trace-viewer"><div className="trace-viewer-header"><strong>TRACE CORRELATION DEBUGGER</strong><button className="trace-refresh-btn" onClick={()=>void load()}>REFRESH</button></div><div className="trace-viewer-body">
  <div className="trace-viewer-meta"><select value={selected} onChange={e=>setSelected(e.target.value)}>{sessions.map(s=><option key={s}>{s}</option>)}</select><span>{current.length}/{selectedTraces.length} traces {imported?'· READ ONLY':''}</span></div>
  {error&&<div className="trace-message">{error}</div>}
  <div style={{display:'flex',gap:4,flexWrap:'wrap'}}><button onClick={finding} disabled={!issues.length||imported}>Create Debug Finding</button><button onClick={exportBundle} disabled={!selectedTraces.length}>Export Sanitized JSON</button><button onClick={()=>input.current?.click()}>Import Bundle</button><input ref={input} hidden type="file" accept="application/json" onChange={e=>void importBundle(e.target.files?.[0])}/></div>
  <div className="trace-viewer-meta"><span>By agent: {grouped.agents||'—'}</span><span>By type: {grouped.types||'—'}</span></div><div className="trace-viewer-meta"><span>By task_title: {grouped.tasks||'—'}</span></div>
  {issues.map(a=><div className="trace-message trace-message--error" key={a.signature}>⚠ {a.text} <small>{a.hint}</small></div>)}
  <strong>LENS WARNINGS ({lensWarnings.length})</strong>{lensWarnings.map((w,i)=><div className="trace-message" key={i}>⚠ {w}</div>)}
  <div className="trace-viewer-meta"><span>Tasks: {related.map(t=>t.title).join(', ')||'—'}</span><span>Events: {events.filter(e=>selectedTraces.some(t=>taskTitle(t)&&e.message.includes(taskTitle(t)))).slice(0,3).map(e=>e.message).join(' | ')||'—'}</span></div>
  <div className="trace-viewer-meta"><span>Agents: {[...new Set(selectedTraces.map(t=>t.agent_id))].map(id=>`${id}:${agents[id as keyof typeof agents]?.status??'unknown'}`).join(' · ')||'—'}</span></div>
  <div className="trace-list">{current.length===0&&<div className="lens-empty">No matching traces · <button onClick={clearLens}>Clear all</button></div>}{current.map(t=><article className="trace-card" key={t.id}><div className="trace-card-top"><span className={`trace-badge ${badge(t.trace_type)}`}>{t.trace_type}</span><strong>{t.agent_id}</strong><time>{formatKstTime(t.created_at)} KST</time></div><p>{highlightParts(`${taskTitle(t)||'task —'} · ${t.model??'model —'} · ${t.latency_ms??'—'}ms`,lens.keyword).map((part,index)=>part.match?<mark key={index}>{part.text}</mark>:part.text)}</p></article>)}</div>
 </div></section>
}
