'use client';

import { useEffect, useRef, useState } from 'react';
import { useSimStore } from '@/store/simulationStore';
import { formatKstTime } from '@/lib/time';
import type { EventType } from '@/types';
import { eventMatchesLens, highlightParts, useOperationsLens } from '@/store/operationsLensStore';

const TYPE_STYLE: Record<EventType, { color: string; bg: string; prefix: string }> = {
  task:    { color: '#93C5FD', bg: 'rgba(37,99,235,0.18)',  prefix: 'TASK'  },
  meeting: { color: '#6EE7B7', bg: 'rgba(16,185,129,0.18)', prefix: 'MTG'   },
  chat:    { color: '#FDBA74', bg: 'rgba(234,88,12,0.18)',  prefix: 'CHAT'  },
  review:  { color: '#D8B4FE', bg: 'rgba(124,58,237,0.18)', prefix: 'REV'   },
  planning:{ color: '#BAE6FD', bg: 'rgba(14,165,233,0.18)', prefix: 'PLAN'  },
  system:  { color: '#94A3B8', bg: 'rgba(71,85,105,0.22)',  prefix: 'SYS'   },
};

export default function EventLog() {
  const allEvents = useSimStore(s => s.events);
  const tasks = useSimStore(s => s.tasks);
  const lens = useOperationsLens(s => s.filters);
  const lensTraces = useOperationsLens(s => s.traceRows);
  const clearLens = useOperationsLens(s => s.clear);
  const events = allEvents.filter(event => eventMatchesLens(event, lens, tasks, lensTraces));
  const scrollRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = 0;
  }, [events.length]);

  return (
    <div className={`event-log${collapsed ? ' event-log--collapsed' : ''}`}>

      {/* ── Header ── */}
      <div className="event-log-header">
        <div className="event-log-title">
          <span>📝 EVENT LOG</span>
          <span className="event-log-badge">{events.length}/{allEvents.length}</span>
        </div>
        <button
          className="panel-collapse-btn"
          onClick={() => setCollapsed(c => !c)}
          type="button"
        >
          {collapsed ? '▼ SHOW' : '▲ HIDE'}
        </button>
      </div>

      {/* ── Log body ── */}
      {!collapsed && (
        <div ref={scrollRef} className="event-log-body">
          {events.length === 0 && (
            <span className="event-log-empty">No matching events · <button onClick={clearLens}>Clear all</button></span>
          )}
          {events.map(evt => {
            const s = TYPE_STYLE[evt.type] ?? TYPE_STYLE.system;
            return (
              <div key={evt.id} className="event-log-row">
                <span className="event-log-ts">{formatKstTime(evt.timestamp)}</span>
                <span
                  className="event-log-badge-type"
                  style={{ color: s.color, background: s.bg }}
                >
                  {highlightParts(`${s.prefix} ${evt.type}`, lens.keyword).map((part, index) =>
                    part.match ? <mark key={index}>{part.text}</mark> : part.text,
                  )}
                </span>
                <span className="event-log-msg">
                  {highlightParts(evt.message, lens.keyword).map((part, index) =>
                    part.match ? <mark key={index}>{part.text}</mark> : part.text,
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
