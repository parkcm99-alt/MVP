/**
 * Supabase persistence helpers — Phase 2.
 *
 * upsertAgent — writes agent state to the `agents` table (conflict: id + session_id)
 * upsertTask  — writes task state to the `tasks`  table (conflict: id)
 *
 * Both are:
 *   • fire-and-forget (callers use void)
 *   • null-safe (no-op when Supabase is not configured)
 *   • non-fatal (logs + reports partial error, never throws)
 */

import { getSupabaseClient, isSupabaseConfigured } from './client';
import { getSessionId } from './session';
import { reportPersistenceError } from './errorTracker';
import type { AgentInsert, TaskInsert } from './types';
import type { Agent, SimTask } from '@/types';

export async function upsertAgent(agent: Agent): Promise<void> {
  if (!isSupabaseConfigured) return;
  const sb = getSupabaseClient();
  if (!sb) return;

  const row: AgentInsert = {
    id:              agent.id,
    session_id:      getSessionId(),
    name:            agent.name,
    emoji:           agent.emoji,
    status:          agent.status,
    current_task:    agent.currentTask,
    position_x:      Math.round(agent.position.x),
    position_y:      Math.round(agent.position.y),
    completed_tasks: agent.completedTasks,
  };

  const { error } = await sb
    .from('agents')
    .upsert(row, { onConflict: 'id,session_id' });

  if (error) {
    console.warn('[Supabase] agents upsert failed:', error.message);
    reportPersistenceError();
  }
}

export async function upsertTask(task: SimTask): Promise<void> {
  if (!isSupabaseConfigured) return;
  const sb = getSupabaseClient();
  if (!sb) return;

  const row: TaskInsert = {
    id:          task.id,
    session_id:  getSessionId(),
    title:       task.title,
    description: task.description,
    assigned_to: task.assignedTo,
    status:      task.status,
    priority:    task.priority,
  };

  const { error } = await sb
    .from('tasks')
    .upsert(row, { onConflict: 'id' });

  if (error) {
    console.warn('[Supabase] tasks upsert failed:', error.message);
    reportPersistenceError();
  }
}
