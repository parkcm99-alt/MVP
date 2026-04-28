import { create } from 'zustand';
import type { Agent, AgentRole, AgentStatus, SimEvent, SimTask, Position, EventType } from '@/types';
import { AGENTS_INIT } from '@/lib/simulation/config';

interface SimulationStore {
  agents: Record<AgentRole, Agent>;
  tasks: SimTask[];
  events: SimEvent[];
  isRunning: boolean;

  moveAgent: (id: AgentRole, pos: Position) => void;
  setStatus: (id: AgentRole, status: AgentStatus) => void;
  setSpeech: (id: AgentRole, speech: string | null) => void;
  setTask: (id: AgentRole, task: string | null) => void;
  bumpCompleted: (id: AgentRole) => void;

  addTask: (t: Omit<SimTask, 'id' | 'createdAt' | 'updatedAt'>) => void;
  updateTask: (id: string, patch: Partial<SimTask>) => void;

  addEvent: (e: Omit<SimEvent, 'id' | 'timestamp'>) => void;

  setRunning: (v: boolean) => void;
}

const buildInitialAgents = (): Record<AgentRole, Agent> =>
  Object.fromEntries(
    AGENTS_INIT.map(cfg => [
      cfg.id,
      {
        ...cfg,
        position: { ...cfg.deskPosition },
        status: 'idle' as AgentStatus,
        currentTask: null,
        speech: null,
        completedTasks: 0,
      },
    ]),
  ) as Record<AgentRole, Agent>;

export const useSimStore = create<SimulationStore>((set) => ({
  agents: buildInitialAgents(),
  tasks: [],
  events: [],
  isRunning: false,

  moveAgent: (id, pos) =>
    set(s => ({ agents: { ...s.agents, [id]: { ...s.agents[id], position: pos } } })),

  setStatus: (id, status) =>
    set(s => ({ agents: { ...s.agents, [id]: { ...s.agents[id], status } } })),

  setSpeech: (id, speech) =>
    set(s => ({ agents: { ...s.agents, [id]: { ...s.agents[id], speech } } })),

  setTask: (id, currentTask) =>
    set(s => ({ agents: { ...s.agents, [id]: { ...s.agents[id], currentTask } } })),

  bumpCompleted: (id) =>
    set(s => ({
      agents: {
        ...s.agents,
        [id]: { ...s.agents[id], completedTasks: s.agents[id].completedTasks + 1 },
      },
    })),

  addTask: (t) =>
    set(s => ({
      tasks: [
        ...s.tasks,
        { ...t, id: uid(), createdAt: Date.now(), updatedAt: Date.now() },
      ],
    })),

  updateTask: (id, patch) =>
    set(s => ({
      tasks: s.tasks.map(t => (t.id === id ? { ...t, ...patch, updatedAt: Date.now() } : t)),
    })),

  addEvent: (e) =>
    set(s => ({
      events: [
        { ...e, id: uid(), timestamp: Date.now() },
        ...s.events,
      ].slice(0, 60),
    })),

  setRunning: (isRunning) => set({ isRunning }),
}));

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}
