/**
 * eventBus — typed mock event layer
 *
 * Emits named events and writes them into the Zustand store (SimEvent).
 * Transport hooks:
 *   - Supabase Realtime: realtimeAdapter.broadcast() (no-op in mock mode, live when configured)
 *   - AgentOps:          TODO — agentops.trackEvent() call (Milestone 3)
 */

import { useSimStore } from '@/store/simulationStore';
import { realtimeAdapter } from '@/lib/supabase/realtime';
import type { BusEventType, BusPayload, EventType } from '@/types';

// Maps bus event types → display category used in EventLog
const BUS_TO_DISPLAY: Record<BusEventType, EventType> = {
  'task.created':          'task',
  'agent.assigned':        'task',
  'agent.moved':           'system',
  'agent.status.changed':  'system',
  'agent.message':         'chat',
  'meeting.started':       'meeting',
  'task.completed':        'task',
  'issue.found':           'review',
};

function formatMessage(type: BusEventType, payload: BusPayload): string {
  const agent = useSimStore.getState().agents[payload.agentId];
  const d = payload.data ?? {};
  switch (type) {
    case 'task.created':         return `[${agent.name}] 새 태스크 생성: ${d.title ?? ''}`;
    case 'agent.assigned':       return `[${agent.name}] 태스크 할당: ${d.task ?? ''}`;
    case 'agent.moved':          return `[${agent.name}] 이동 중`;
    case 'agent.status.changed': return `[${agent.name}] 상태 → ${d.status ?? ''}`;
    case 'agent.message':        return `[${agent.name}] ${d.message ?? ''}`;
    case 'meeting.started':      return `[${agent.name}] 미팅 시작`;
    case 'task.completed':       return `[${agent.name}] 태스크 완료: ${d.task ?? ''}`;
    case 'issue.found':          return `[${agent.name}] 이슈 발견: ${d.issue ?? ''}`;
    default:                     return `[${agent.name}] 이벤트 발생`;
  }
}

export const eventBus = {
  emit(type: BusEventType, payload: BusPayload): void {
    const store = useSimStore.getState();
    const agent = store.agents[payload.agentId];

    store.addEvent({
      agentId:    payload.agentId,
      agentName:  agent.name,
      agentColor: agent.primaryColor,
      type:       BUS_TO_DISPLAY[type],
      message:    formatMessage(type, payload),
    });

    // Supabase Realtime broadcast (no-op in mock mode, live when NEXT_PUBLIC_SUPABASE_URL is set)
    void realtimeAdapter.broadcast(type, payload);

    // TODO (Milestone 3): AgentOps hook
    // agentops.trackEvent({ agentId: payload.agentId, eventName: type, payload: payload.data ?? {}, timestamp: Date.now() });
  },
};
