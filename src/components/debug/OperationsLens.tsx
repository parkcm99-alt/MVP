'use client';
import { useLensStore } from '@/store/lensStore';
const fields = [
  ['role','Role',['','planner','architect','developer','reviewer','qa']],
  ['status','Task status',['','backlog','in_progress','review','done']],
  ['priority','Priority',['','high','medium','low']],
  ['traceType','Trace type',['','llm_call','handoff','decision','tool_use']],
] as const;
export default function OperationsLens() {
 const { filters, setFilter, clear } = useLensStore();
 return <div style={{display:'flex',gap:4,alignItems:'center',padding:'3px 8px',background:'#07111f',borderBottom:'1px solid #1e293b',fontSize:9}}><strong style={{color:'#93c5fd'}}>OPERATIONS LENS</strong>{fields.map(([key,label,opts])=><select aria-label={label} key={key} value={filters[key]} onChange={e=>setFilter(key,e.target.value)} style={{background:'#0b1728',color:'#cbd5e1',fontSize:9}}>{opts.map(v=><option key={v} value={v}>{v||label}</option>)}</select>)}<input aria-label="Session ID" placeholder="sessionId" value={filters.sessionId} onChange={e=>setFilter('sessionId',e.target.value)} style={{width:100,background:'#0b1728',color:'#cbd5e1',fontSize:9}}/><input aria-label="Keyword" placeholder="keyword" value={filters.keyword} onChange={e=>setFilter('keyword',e.target.value)} style={{width:110,background:'#0b1728',color:'#cbd5e1',fontSize:9}}/><button type="button" onClick={clear} style={{fontSize:9}}>Clear all</button></div>;
}
