'use client';
import { useOperationsLens, type LensFilters } from '@/store/operationsLensStore';
const fields: Array<[keyof LensFilters,string,string[]]> = [
  ['role','All agents',['planner','architect','developer','reviewer','qa']],
  ['status','All statuses',['backlog','in_progress','review','done']],
  ['priority','All priorities',['high','medium','low']],
  ['traceType','All trace types',['llm_call','handoff','decision','tool_use']],
];
export default function OperationsLens(){const lens=useOperationsLens();return <div style={{display:'flex',gap:5,padding:'6px 10px',background:'#08111f',borderBottom:'1px solid #1e293b',flexWrap:'wrap',alignItems:'center',fontFamily:'monospace',fontSize:9}}><b style={{color:'#67e8f9'}}>OPERATIONS LENS</b>{fields.map(([key,label,values])=><select key={key} value={lens[key]} onChange={e=>lens.setFilter(key,e.target.value)} style={{background:'#0f172a',color:'#cbd5e1'}}><option value="">{label}</option>{values.map(v=><option key={v}>{v}</option>)}</select>)}<input value={lens.sessionId} onChange={e=>lens.setFilter('sessionId',e.target.value)} placeholder="sessionId" style={{width:120,background:'#0f172a',color:'#cbd5e1'}}/><input value={lens.keyword} onChange={e=>lens.setFilter('keyword',e.target.value)} placeholder="keyword" style={{width:130,background:'#0f172a',color:'#cbd5e1'}}/><button className="trace-refresh-btn" onClick={lens.clearAll}>CLEAR ALL</button></div>}
