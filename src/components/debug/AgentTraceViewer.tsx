'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { AgentTraceRow } from '@/lib/supabase/types';
import { formatKstTime } from '@/lib/time';
import { useSimStore } from '@/store/simulationStore';
import { useDebugStore } from '@/store/debugStore';
import { getSessionId } from '@/lib/supabase/session';
import { lensTextMatch, useOperationsLens } from '@/store/operationsLensStore';
import LensHighlight from '@/components/debug/LensHighlight';

interface Props { refreshKey?: number | null }
interface Bundle { schemaVersion: 1; exportedAt: string; sessionId: string; traces: AgentTraceRow[] }
interface Anomaly { signature: string; message: string; hint: string; owner: 'reviewer' | 'qa' }
const LIMIT = 100;
const SECRET = /(api.?key|authorization|bearer|credential|password|secret|service.?role|token)/i;

function sanitize(value: unknown, key = ''): unknown {
  if (SECRET.test(key)) return '[REDACTED]';
  if (typeof value === 'string' && (/(bearer\s+[a-z0-9._-]+)/i.test(value) || /sk-ant-/i.test(value))) return '[REDACTED]';
  if (Array.isArray(value)) return value.map(v => sanitize(v));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k, sanitize(v,k)]));
  return value;
}
function isTraceRow(value: unknown): value is AgentTraceRow {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<AgentTraceRow>;
  return typeof row.id === 'string' && typeof row.session_id === 'string'
    && typeof row.agent_id === 'string' && typeof row.trace_type === 'string'
    && typeof row.created_at === 'string'
    && (row.metadata === null || row.metadata === undefined || typeof row.metadata === 'object');
}
function taskTitle(t: AgentTraceRow): string { const v=t.metadata?.task_title ?? t.metadata?.taskTitle; return typeof v==='string'?v:''; }
function badge(type:string){return `trace-badge trace-badge--${type==='llm_call'?'llm':type==='handoff'?'handoff':type==='decision'?'decision':type==='tool_use'?'tool':'unknown'}`}
function countGroups(traces:AgentTraceRow[], key:(trace:AgentTraceRow)=>string):string[]{const counts=new Map<string,number>();for(const trace of traces){const k=key(trace);counts.set(k,(counts.get(k)??0)+1)}return [...counts].map(([k,v])=>`${k}:${v}`)}
function anomalies(traces: AgentTraceRow[], call: ReturnType<typeof useDebugStore.getState>['planner']): Anomaly[] {
  const out: Anomaly[]=[]; const hasDecision=new Set(traces.filter(t=>t.trace_type==='decision').map(taskTitle));
  for(const t of traces){
    const title=taskTitle(t);
    if(t.trace_type==='handoff' && t.agent_id==='planner' && title && !hasDecision.has(title)) out.push({signature:`handoff:${title}`,message:`Planner handoff 뒤 decision 누락: ${title}`,hint:'담당 agent workflow 시작과 decision insert를 확인하세요.',owner:'reviewer'});
    if((t.latency_ms??0)>=10000) out.push({signature:`latency:${t.id}`,message:`LLM 지연 ${t.latency_ms}ms: ${t.agent_id}`,hint:'timeout, provider 상태, 모델 설정을 확인하세요.',owner:'qa'});
    const status=String(t.metadata?.finalStatus ?? t.metadata?.approvalStatus ?? '').toLowerCase();
    if(/failed|changes_requested|needs_more/.test(status)) out.push({signature:`status:${t.id}:${status}`,message:`실패 계열 상태 감지: ${status}`,hint:'관련 task를 reviewer/QA로 재검증하세요.',owner:'qa'});
  }
  if(call.sessionId && traces.some(t=>t.session_id===call.sessionId) && (call.traceRecorded===false || !traces.some(t=>t.trace_type==='llm_call' && t.agent_id===(call.role??'planner')))) out.push({signature:`missing-call:${call.sessionId}:${call.role}`,message:`Ask ${call.role ?? 'Agent'} 호출의 llm_call/trace 기록 누락`,hint:'ENABLE_LIVE_LLM, service role key, RLS와 Vercel logs를 확인하세요.',owner:'reviewer'});
  return [...new Map(out.map(a=>[a.signature,a])).values()];
}

export default function AgentTraceViewer({refreshKey=null}:Props){
  const [collapsed,setCollapsed]=useState(false); const [traces,setTraces]=useState<AgentTraceRow[]>([]);
  const [selected,setSelected]=useState(''); const [error,setError]=useState<string|null>(null); const [imported,setImported]=useState(false);
  const input=useRef<HTMLInputElement>(null); const tasks=useSimStore(s=>s.tasks); const events=useSimStore(s=>s.events); const agents=useSimStore(s=>s.agents);
  const debug=useDebugStore(s=>s.planner); const setHighlight=useDebugStore(s=>s.setHighlightedTaskId);
  const lens=useOperationsLens();
  const load=useCallback(async()=>{const local=()=>useSimStore.getState().events.slice(0,LIMIT).map((e,i):AgentTraceRow=>({id:`local-${e.id}`,session_id:getSessionId(),agent_id:e.agentId,trace_type:e.type==='planning'?'llm_call':e.type==='task'?'decision':'tool_use',input_tokens:null,output_tokens:null,latency_ms:null,model:'local-mock',metadata:{task_title:e.message.slice(0,80),source:'local_event'},created_at:new Date(e.timestamp+i).toISOString()})); const sb=getSupabaseClient(); if(!sb){setTraces(local());setImported(false);setError('Supabase unavailable — local/mock analysis mode');return;} const {data,error:e}=await sb.from('agent_traces').select('id,session_id,agent_id,trace_type,input_tokens,output_tokens,latency_ms,model,metadata,created_at').order('created_at',{ascending:false}).limit(LIMIT); if(e){setTraces(local());setImported(false);setError('Trace query failed — local/mock analysis mode');return;} setTraces((data??[]) as AgentTraceRow[]); setImported(false); setError(null);},[]);
  useEffect(()=>{void load()},[load,refreshKey]);
  const sessions=useMemo(()=>[...new Set(traces.map(t=>t.session_id))],[traces]);
  useEffect(()=>{if(!selected&&sessions[0])setSelected(sessions[0])},[sessions,selected]);
  const current=useMemo(()=>traces.filter(t=>t.session_id===selected),[traces,selected]);
  const visible=useMemo(()=>current.filter(t=>(!lens.role||t.agent_id===lens.role)&&(!lens.traceType||t.trace_type===lens.traceType)&&(!lens.sessionId||t.session_id.includes(lens.sessionId))&&(!lens.status||String(t.metadata?.status??t.metadata?.finalStatus??t.metadata?.approvalStatus??'')===lens.status)&&(!lens.priority||String(t.metadata?.priority??'')===lens.priority)&&lensTextMatch(`${t.agent_id} ${t.trace_type} ${taskTitle(t)} ${t.model??''}`,lens.keyword)),[current,lens]);
  const issues=useMemo(()=>anomalies(visible,debug),[visible,debug]);
  const groups=useMemo(()=>({agents:countGroups(visible,t=>t.agent_id),types:countGroups(visible,t=>t.trace_type),tasks:countGroups(visible,t=>taskTitle(t)||'(none)').slice(0,6)}),[visible]);
  const relatedTitles=useMemo(()=>new Set(visible.map(taskTitle).filter(Boolean)),[visible]);
  const relatedTasks=useMemo(()=>tasks.filter(t=>relatedTitles.has(t.title)||[...relatedTitles].some(x=>t.description.includes(x))),[tasks,relatedTitles]);
  const relatedEvents=useMemo(()=>events.filter(e=>[...relatedTitles].some(x=>e.message.includes(x))||visible.some(t=>e.agentId===t.agent_id)).slice(0,8),[events,relatedTitles,visible]);
  const lensWarnings=useMemo(()=>{const w:string[]=[];if(relatedTasks.length&&!relatedEvents.length)w.push('Matching task has no related event.');if(relatedTasks.length&&!visible.length)w.push('Matching task has no related trace.');if(lens.sessionId&&selected&&!selected.includes(lens.sessionId))w.push('Selected trace session does not match sessionId filter.');if(lens.role&&visible.some(t=>t.agent_id!==lens.role))w.push('Agent role mismatch detected.');return w},[relatedTasks,relatedEvents,visible,lens.sessionId,lens.role,selected]);
  useEffect(()=>{setHighlight(relatedTasks[0]?.id??null); return()=>setHighlight(null)},[relatedTasks,setHighlight]);
  function createFinding(){if(imported||!issues[0])return; const sig=`[debug-finding:${selected}:${issues[0].signature}]`; if(tasks.some(t=>t.description.includes(sig)))return; const role=issues[0].owner; useSimStore.getState().addLocalTask({title:`Trace finding: ${role}`,description:`${sig} ${issues[0].message}`,assignedTo:role,status:'backlog',priority:'high'}); const a=agents[role]; useSimStore.getState().addEvent({agentId:role,agentName:a.name,agentColor:a.primaryColor,type:'review',message:`[${a.name}] Debug finding 생성: ${issues[0].message}`});}
  function exportBundle(){const bundle:Bundle={schemaVersion:1,exportedAt:new Date().toISOString(),sessionId:selected,traces:current}; const blob=new Blob([JSON.stringify(sanitize(bundle),null,2)],{type:'application/json'}); const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`trace-${selected.slice(0,8)}.sanitized.json`;a.click();URL.revokeObjectURL(a.href)}
  async function importBundle(file:File){try{const raw=JSON.parse(await file.text()) as Partial<Bundle>; if(raw.schemaVersion!==1||!Array.isArray(raw.traces)||!raw.traces.every(isTraceRow)||typeof raw.sessionId!=='string')throw new Error(); const clean=sanitize(raw) as Bundle; setTraces(clean.traces.slice(0,LIMIT));setSelected(clean.sessionId);setImported(true);setError('Read-only imported bundle — no database writes.');}catch{setError('Invalid or unsupported sanitized bundle.');}}
  return <section className={`trace-viewer${collapsed?' trace-viewer--collapsed':''}`}><div className="trace-viewer-header"><button className="trace-viewer-toggle" onClick={()=>setCollapsed(v=>!v)}><span>TRACE CORRELATION DEBUGGER</span><strong>{traces.length}/{LIMIT}</strong></button><button className="trace-refresh-btn" onClick={()=>void load()}>REFRESH</button></div>{!collapsed&&<div className="trace-viewer-body">
    {error&&<div className="trace-message">{error}</div>}
    <select value={selected} onChange={e=>setSelected(e.target.value)} style={{width:'100%',background:'#0f172a',color:'#cbd5e1'}}>{sessions.map(s=><option key={s}>{s}</option>)}</select>
    <div style={{display:'flex',gap:4,flexWrap:'wrap',margin:'6px 0'}}><button className="trace-refresh-btn" disabled={!selected} onClick={exportBundle}>EXPORT SANITIZED JSON</button><button className="trace-refresh-btn" onClick={()=>input.current?.click()}>IMPORT</button><input ref={input} type="file" accept="application/json" hidden onChange={e=>e.target.files?.[0]&&void importBundle(e.target.files[0])}/><button className="trace-refresh-btn" disabled={imported||!issues.length} onClick={createFinding}>CREATE DEBUG FINDING</button></div>
    <div className="trace-viewer-meta"><span>{visible.length}/{current.length} traces · {relatedTasks.length} tasks · {relatedEvents.length} events</span><span>{imported?'READ-ONLY IMPORT':'LIVE/LOCAL'}</span></div>
    {!visible.length&&<div className="trace-message">No traces match. <button onClick={lens.clearAll}>Clear all</button></div>}
    {lensWarnings.map(w=><div key={w} className="trace-message">Lens warning: {w}</div>)}
    <div style={{fontSize:8,color:'#94a3b8'}}>AGENT {groups.agents.join(' · ')}<br/>TYPE {groups.types.join(' · ')}<br/>TASK {groups.tasks.join(' · ')}</div>
    {issues.map(a=><div key={a.signature} style={{borderLeft:'3px solid #ef4444',padding:'4px',margin:'3px 0',fontSize:9}}><b>{a.message}</b><br/><span>{a.hint}</span></div>)}
    {relatedTasks.map(t=><div key={t.id} style={{fontSize:9,color:'#facc15'}}>TASK ↗ {t.title} ({t.status})</div>)}
    {relatedEvents.map(e=><div key={e.id} style={{fontSize:8,color:'#94a3b8'}}>EVENT {formatKstTime(e.timestamp)} {e.message}</div>)}
    <div style={{fontSize:9,margin:'5px 0'}}>AGENTS {Object.values(agents).map(a=>`${a.name}:${a.status}`).join(' · ')}</div>
    <div className="trace-list">{visible.map(t=><article className="trace-card" key={t.id}><div className="trace-card-top"><span className={badge(t.trace_type)}>{t.trace_type}</span><strong>{t.agent_id}</strong><time>{formatKstTime(t.created_at)} KST</time></div><div className="trace-card-metrics"><span>{t.model??'model —'}</span><span>{t.latency_ms??'—'}ms</span><span><LensHighlight text={taskTitle(t)||'task —'} keyword={lens.keyword}/></span></div></article>)}</div>
  </div>}</section>
}
