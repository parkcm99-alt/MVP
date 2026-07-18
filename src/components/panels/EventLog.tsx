'use client';

import { useEffect, useRef, useState } from 'react';
import LensHighlight from '@/components/debug/LensHighlight';
import { useOperationsData } from '@/hooks/useOperationsData';
import { useLensStore } from '@/store/lensStore';
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
  const { filters, events: allEvents, filtered } = useOperationsData();
  const events = filtered.events.slice(0, 200);
  const clearLens = useLensStore(state => state.clear);
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
          <span className="panel-badge">{filtered.events.length}/{allEvents.length}</span>
        </div>
        <div className="panel-filter-meta">
          <button className="panel-clear-btn" type="button" onClick={clearLens}>Clear all</button>
          <button className="panel-collapse-btn" type="button" onClick={() => setCollapsed(c => !c)}>{collapsed ? '▼ SHOW' : '▲ HIDE'}</button>
        </div>
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
          {events.length === 0 && (
            <div className="lens-empty">{allEvents.length ? 'No matching events.' : 'Waiting for events...'} <button type="button" onClick={clearLens}>Clear all</button></div>
          )}
          {events.map(evt => {
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
                <span style={{ color: '#CBD5E1' }}><LensHighlight text={evt.message} query={filters.keyword} /></span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
