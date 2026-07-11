'use client';

import { useEffect, useRef, useState } from 'react';
import { useSimStore } from '@/store/simulationStore';
import { formatKstTime } from '@/lib/time';
import type { EventType } from '@/types';
import { getSessionId } from '@/lib/supabase/session';
import { textMatches, useOperationsLensStore } from '@/store/operationsLensStore';
import { useTraceDebugStore } from '@/store/traceDebugStore';

const TYPE_STYLE: Record<EventType, { color: string; prefix: string }> = {
  task:    { color: '#60A5FA', prefix: '[TASK]' },
  meeting: { color: '#34D399', prefix: '[MTG]'  },
  chat:    { color: '#F97316', prefix: '[CHAT]' },
  review:  { color: '#C084FC', prefix: '[REV]'  },
  planning:{ color: '#93C5FD', prefix: '[PLAN]' },
  system:  { color: '#94A3B8', prefix: '[SYS]'  },
};


const EXPANDED_HEIGHT = 130;
const COLLAPSED_HEIGHT = 28; // header only

export default function EventLog() {
  const events    = useSimStore(s => s.events);
  const tasks = useSimStore(s => s.tasks);
  const lens = {
    agentRole: useOperationsLensStore(s => s.agentRole),
    taskStatus: useOperationsLensStore(s => s.taskStatus),
    priority: useOperationsLensStore(s => s.priority),
    traceType: useOperationsLensStore(s => s.traceType),
    sessionId: useOperationsLensStore(s => s.sessionId),
    keyword: useOperationsLensStore(s => s.keyword),
  };
  const clearLens = useOperationsLensStore(s => s.clearAll);
  const localTraces = useTraceDebugStore(s => s.localTraces);
  const remoteTraces = useTraceDebugStore(s => s.remoteTraces);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const sessionMatches = !lens.sessionId || getSessionId().toLowerCase().includes(lens.sessionId.toLowerCase());
  const filteredEvents = events.filter(event => {
    const related = tasks.filter(task => event.message.includes(task.title) || task.assignedTo === event.agentId);
    return sessionMatches &&
      (!lens.agentRole || event.agentId === lens.agentRole) &&
      (!lens.taskStatus || related.some(task => task.status === lens.taskStatus)) &&
      (!lens.priority || related.some(task => task.priority === lens.priority)) &&
      (!lens.traceType || [...localTraces, ...remoteTraces].some(trace => trace.trace_type === lens.traceType && trace.agent_id === event.agentId)) &&
      textMatches(lens.keyword, event.message, event.agentName, event.agentId, event.type);
  });
  const highlight = (value: string) => {
    const needle = lens.keyword.trim();
    const index = value.toLowerCase().indexOf(needle.toLowerCase());
    return !needle || index < 0 ? value : <>{value.slice(0, index)}<mark className="lens-mark">{value.slice(index, index + needle.length)}</mark>{value.slice(index + needle.length)}</>;
  };

  // scroll to top (newest event) on update
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = 0;
  }, [events.length]);

  return (
    <div
      style={{
        height:        collapsed ? COLLAPSED_HEIGHT : EXPANDED_HEIGHT,
        flexShrink:    0,
        borderTop:     '2px solid var(--border)',
        display:       'flex',
        flexDirection: 'column',
        overflow:      'hidden',
        transition:    'height 0.18s ease',
        background:    '#060D17',
      }}
    >
      {/* header */}
      <div className="panel-header" style={{ flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>📝 EVENT LOG</span>
          <span className="panel-badge">{filteredEvents.length}/{events.length}</span>
          <button className="panel-collapse-btn" onClick={clearLens}>CLEAR ALL</button>
        </div>
        <button
          className="panel-collapse-btn"
          onClick={() => setCollapsed(c => !c)}
        >
          {collapsed ? '▼ SHOW' : '▲ HIDE'}
        </button>
      </div>

      {/* body — hidden when collapsed */}
      {!collapsed && (
        <div
          ref={scrollRef}
          className="panel-body"
          style={{
            flex:          1,
            overflowY:     'auto',
            display:       'flex',
            flexDirection: 'column',
            gap:           2,
          }}
        >
          {filteredEvents.length === 0 && (
            <span style={{ color: '#475569', fontFamily: 'monospace', fontSize: 10 }}>
              No events match the Operations Lens.
            </span>
          )}
          {filteredEvents.map(evt => {
            const style = TYPE_STYLE[evt.type] ?? TYPE_STYLE.system;
            return (
              <div
                key={evt.id}
                style={{
                  display:    'flex',
                  gap:        6,
                  alignItems: 'flex-start',
                  fontSize:   10,
                  fontFamily: 'monospace',
                  lineHeight: 1.5,
                  animation:  'eventIn 0.2s ease-out',
                }}
              >
                <span style={{ color: '#334155', flexShrink: 0 }}>{formatKstTime(evt.timestamp)}</span>
                <span style={{ color: style.color, flexShrink: 0 }}>{highlight(`${style.prefix} ${evt.agentId}`)}</span>
                <span style={{ color: '#CBD5E1' }}>{highlight(evt.message)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
