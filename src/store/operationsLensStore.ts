import { create } from 'zustand';
import type { AgentRole, TaskPriority, TaskStatus } from '@/types';
export interface LensFilters { role: AgentRole | ''; status: TaskStatus | ''; priority: TaskPriority | ''; traceType: string; sessionId: string; keyword: string }
const empty: LensFilters = { role:'', status:'', priority:'', traceType:'', sessionId:'', keyword:'' };
export const useOperationsLens = create<{filters:LensFilters; set:(p:Partial<LensFilters>)=>void; clear:()=>void}>((set)=>({filters:empty,set:(p)=>set(s=>({filters:{...s.filters,...p}})),clear:()=>set({filters:empty})}));
export function lensText(value:string, keyword:string){ return !keyword || value.toLowerCase().includes(keyword.toLowerCase()); }
