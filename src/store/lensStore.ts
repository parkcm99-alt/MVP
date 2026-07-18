import { create } from 'zustand';
export interface LensFilters { role: string; status: string; priority: string; traceType: string; sessionId: string; keyword: string }
const initial: LensFilters = { role: '', status: '', priority: '', traceType: '', sessionId: '', keyword: '' };
interface LensStore { filters: LensFilters; setFilter: (key: keyof LensFilters, value: string) => void; clear: () => void; clearAll: () => void }
export const useLensStore = create<LensStore>(set => ({ filters: initial, setFilter: (key, value) => set(s => ({ filters: { ...s.filters, [key]: value } })), clear: () => set({ filters: initial }), clearAll: () => set({ filters: initial }) }));
