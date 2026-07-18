'use client';

import { useEffect, useRef, useState } from 'react';
import { useSimStore } from '@/store/simulationStore';
import HighlightText from '@/components/debug/HighlightText';
import { mergeTraces } from '@/lib/debug/correlation';
import { applyOperationsLens } from '@/lib/debug/operationsLens';
import { useDebugStore } from '@/store/debugStore';
import { hasActiveFilters, useOperationsStore } from '@/store/operationsStore';
import { formatKstTime } from '@/lib/time';
import type { EventType } from '@/types';

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
  const remote = useDebugStore(s => s.remoteTraces);
  const local = useDebugStore(s => s.localTraces);
  const filters = useOperationsStore(s => s.filters);
  const clear = useOperationsStore(s => s.clearFilters);
  const filtered = applyOperationsLens(filters, tasks, events, mergeTraces(remote, local)).events;
  const visible = filtered.slice(0, 200);
  const active = hasActiveFilters(filters);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);

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
          <span className="panel-badge">{filtered.length}/{events.length}</span>
          {active && <button type="button" className="panel-clear-btn" onClick={clear}>CLEAR</button>}
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
          {visible.length === 0 && <div className="lens-empty">{events.length ? 'No events match this lens.' : 'Waiting for events...'}{active && <button type="button" onClick={clear}>Clear all</button>}</div>}
          {visible.map(evt => {
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
                <span style={{ color: '#CBD5E1' }}><HighlightText text={evt.message} query={filters.keyword} /></span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
