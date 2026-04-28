'use client';

import { useEffect, useRef } from 'react';
import { useSimStore } from '@/store/simulationStore';
import type { EventType } from '@/types';

const TYPE_STYLE: Record<EventType, { color: string; prefix: string }> = {
  task:    { color: '#60A5FA', prefix: '[TASK]'   },
  meeting: { color: '#34D399', prefix: '[MTG]'    },
  chat:    { color: '#F97316', prefix: '[CHAT]'   },
  review:  { color: '#C084FC', prefix: '[REV]'    },
  system:  { color: '#94A3B8', prefix: '[SYS]'    },
};

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

export default function EventLog() {
  const events  = useSimStore(s => s.events);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = 0;
  }, [events.length]);

  return (
    <div className="panel event-log-panel">
      <div className="panel-header">
        <span>📝 EVENT LOG</span>
        <span className="panel-badge">{events.length}</span>
      </div>
      <div
        ref={scrollRef}
        className="panel-body"
        style={{
          overflowY:  'auto',
          maxHeight:  '100%',
          display:    'flex',
          flexDirection: 'column',
          gap: 2,
        }}
      >
        {events.length === 0 && (
          <span style={{ color: '#475569', fontFamily: 'monospace', fontSize: 10 }}>
            Waiting for events...
          </span>
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
              <span style={{ color: '#475569', flexShrink: 0 }}>{fmtTime(evt.timestamp)}</span>
              <span style={{ color: style.color, flexShrink: 0 }}>{style.prefix}</span>
              <span style={{ color: '#CBD5E1' }}>{evt.message}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
