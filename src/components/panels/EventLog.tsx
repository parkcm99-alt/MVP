'use client';

import { useEffect, useRef, useState } from 'react';
import { useSimStore } from '@/store/simulationStore';
import { formatKstTime } from '@/lib/time';
import type { EventType } from '@/types';
import { includesKeyword, useLensStore } from '@/store/lensStore';
import { getSessionId } from '@/lib/supabase/session';
import LensHighlight from '@/components/debug/LensHighlight';
import { useDebugStore } from '@/store/debugStore';

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
  const scrollRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  const lens = useLensStore(s => s.filters);
  const clearLens = useLensStore(s => s.clearAll);
  const tasks = useSimStore(s => s.tasks);
  const observedTraces = useDebugStore(s => s.observedTraces);
  const sessionMatches = !lens.sessionId || getSessionId().includes(lens.sessionId.trim());
  const taskScope = tasks.filter(t =>
    (!lens.status || t.status === lens.status) &&
    (!lens.priority || t.priority === lens.priority) &&
    (!lens.role || t.assignedTo === lens.role)
  );
  const hasTaskFacet = Boolean(lens.status || lens.priority);
  const visibleEvents = events.filter(e =>
    sessionMatches &&
    (!lens.role || e.agentId === lens.role) &&
    (!lens.traceType || observedTraces.some(trace =>
      trace.trace_type === lens.traceType && trace.agent_id === e.agentId
    )) &&
    (!hasTaskFacet || taskScope.some(t =>
      e.message.toLowerCase().includes(t.title.toLowerCase()) ||
      (t.assignedTo !== null && t.assignedTo === e.agentId)
    )) &&
    includesKeyword(e.message, lens.keyword)
  );

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
          <span className="panel-badge">{visibleEvents.length}/{events.length}</span>
        </div>
        <button
          className="panel-collapse-btn"
          onClick={() => setCollapsed(c => !c)}
        >
          {collapsed ? '▼ SHOW' : '▲ HIDE'}
        </button>
        <button className="panel-collapse-btn" type="button" onClick={clearLens}>CLEAR ALL</button>
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
          {visibleEvents.length === 0 && (
            <span style={{ color: '#475569', fontFamily: 'monospace', fontSize: 10 }}>
              No events match · use Clear all
            </span>
          )}
          {visibleEvents.map(evt => {
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
                <span style={{ color: style.color, flexShrink: 0 }}>{style.prefix}</span>
                <span style={{ color: '#CBD5E1' }}><LensHighlight text={evt.message} keyword={lens.keyword} /></span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
