import { create } from 'zustand';
import type { Agent, AgentRole, AgentStatus, SimEvent, SimTask, Position, EventType } from '@/types';
import { AGENTS_INIT } from '@/lib/simulation/config';
import { upsertAgent, upsertTask } from '@/lib/supabase/persistence';

interface SimulationStore {
  agents: Record<AgentRole, Agent>;
  tasks: SimTask[];
  events: SimEvent[];
  isRunning: boolean;

  moveAgent:    (id: AgentRole, pos: Position) => void;
  setStatus:    (id: AgentRole, status: AgentStatus) => void;
  setSpeech:    (id: AgentRole, speech: string | null) => void;
  setTask:      (id: AgentRole, task: string | null) => void;
  bumpCompleted:(id: AgentRole) => void;

  addTask:    (t: Omit<SimTask, 'id' | 'createdAt' | 'updatedAt'>) => void;
  updateTask: (id: string, patch: Partial<SimTask>) => void;

  addEvent: (e: Omit<SimEvent, 'id' | 'timestamp'>) => void;

  setRunning:  (v: boolean) => void;
  resetStore:  () => void;
}

const buildInitialAgents = (): Record<AgentRole, Agent> =>
  Object.fromEntries(
    AGENTS_INIT.map(cfg => [
      cfg.id,
      {
        ...cfg,
        position:       { ...cfg.deskPosition },
        status:         'idle' as AgentStatus,
        currentTask:    null,
        speech:         null,
        completedTasks: 0,
      },
    ]),
  ) as Record<AgentRole, Agent>;

const INITIAL_STATE = () => ({
  agents:    buildInitialAgents(),
  tasks:     [] as SimTask[],
  events:    [] as SimEvent[],
  isRunning: false,
});

export const useSimStore = create<SimulationStore>((set, get) => ({
  ...INITIAL_STATE(),

  moveAgent: (id, pos) => {
    set(s => ({ agents: { ...s.agents, [id]: { ...s.agents[id], position: pos } } }));
    void upsertAgent(get().agents[id]);
  },

  setStatus: (id, status) => {
    set(s => ({ agents: { ...s.agents, [id]: { ...s.agents[id], status } } }));
    void upsertAgent(get().agents[id]);
  },

  // speech is transient UI state — not persisted
  setSpeech: (id, speech) =>
    set(s => ({ agents: { ...s.agents, [id]: { ...s.agents[id], speech } } })),

  setTask: (id, currentTask) => {
    set(s => ({ agents: { ...s.agents, [id]: { ...s.agents[id], currentTask } } }));
    void upsertAgent(get().agents[id]);
  },

  bumpCompleted: (id) => {
    set(s => ({
      agents: {
        ...s.agents,
        [id]: { ...s.agents[id], completedTasks: s.agents[id].completedTasks + 1 },
      },
    }));
    void upsertAgent(get().agents[id]);
  },

  addTask: (t) => {
    const newTask: SimTask = { ...t, id: uuid(), createdAt: Date.now(), updatedAt: Date.now() };
    set(s => ({ tasks: [...s.tasks, newTask] }));
    void upsertTask(newTask);
  },

  updateTask: (id, patch) => {
    set(s => ({
      tasks: s.tasks.map(t => (t.id === id ? { ...t, ...patch, updatedAt: Date.now() } : t)),
    }));
    const updated = get().tasks.find(t => t.id === id);
    if (updated) void upsertTask(updated);
  },

  addEvent: (e) =>
    set(s => ({
      events: [
        { ...e, id: uid(), timestamp: Date.now() },
        ...s.events,
      ].slice(0, 80),
    })),

  setRunning: (isRunning) => set({ isRunning }),

  // Reset clears local state only — Supabase rows are session-scoped and left as-is
  // (no DELETE permission for anon key; stale rows expire naturally with the session)
  resetStore: () => set(INITIAL_STATE()),
}));

// ── ID generators ──────────────────────────────────────────────────────────────

/** UUID v4 — used for task IDs (must match `uuid` column type in Supabase). */
function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Short UID — used for in-memory event IDs only (not persisted). */
function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// Re-export EventType so engine can import from one place
export type { EventType };
