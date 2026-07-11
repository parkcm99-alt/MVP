import { create } from 'zustand';

export interface LensFilters {
  role: string; status: string; priority: string; traceType: string; sessionId: string; keyword: string;
}
const EMPTY: LensFilters = { role:'', status:'', priority:'', traceType:'', sessionId:'', keyword:'' };
interface LensStore extends LensFilters { setFilter:(key:keyof LensFilters,value:string)=>void; clearAll:()=>void }
export const useOperationsLens = create<LensStore>(set=>({
  ...EMPTY,
  setFilter:(key,value)=>set({[key]:value}),
  clearAll:()=>set(EMPTY),
}));
export function lensTextMatch(value:string, keyword:string){return !keyword.trim()||value.toLowerCase().includes(keyword.trim().toLowerCase())}
