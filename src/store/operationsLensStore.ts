import { create } from 'zustand';
export interface LensFilters { role:string; status:string; priority:string; traceType:string; sessionId:string; keyword:string }
const EMPTY:LensFilters={role:'',status:'',priority:'',traceType:'',sessionId:'',keyword:''};
export const useOperationsLens=create<{filters:LensFilters;set:(p:Partial<LensFilters>)=>void;clear:()=>void}>(set=>({filters:EMPTY,set:p=>set(s=>({filters:{...s.filters,...p}})),clear:()=>set({filters:EMPTY})}));
export function textMatch(text:string,keyword:string){return !keyword||text.toLowerCase().includes(keyword.toLowerCase())}
