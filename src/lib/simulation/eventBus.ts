/**
 * eventBus — typed event layer
 *
 * emit() does two things in order:
 *   1. Writes to Zustand store (always, synchronous)
 *   2. Calls realtimeAdapter.broadcast() (async, no-op in mock mode)
 *
 * This order guarantees the UI is never waiting on the network.
 */

import { useSimStore } from '@/store/simulationStore';
import { realtimeAdapter } from '@/lib/supabase/realtime';
import type { BusEventType, BusPayload, EventType } from '@/types';

// Maps bus event types → display category for EventLog / events table
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
    const store     = useSimStore.getState();
    const agent     = store.agents[payload.agentId];
    const eventType = BUS_TO_DISPLAY[type];
    const message   = formatMessage(type, payload);

    // 1. Zustand store — always, synchronous, drives the UI
    store.addEvent({
      agentId:    payload.agentId,
      agentName:  agent.name,
      agentColor: agent.primaryColor,
      type:       eventType,
      message,
    });

    // 2. Supabase insert (no-op when NEXT_PUBLIC_SUPABASE_URL is not set)
    void realtimeAdapter.broadcast(type, payload, {
      message,
      eventType,
      agentName:  agent.name,
      agentColor: agent.primaryColor,
    });

    // TODO (Milestone 3): AgentOps hook
    // agentops.trackEvent({ agentId: payload.agentId, eventName: type, ... });
  },
};
