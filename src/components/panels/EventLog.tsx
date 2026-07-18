'use client';

import { useEffect, useRef, useState } from 'react';
import HighlightedText from '@/components/debug/HighlightedText';
import { mergeTraces } from '@/lib/debug/correlation';
import { filterEvents } from '@/lib/debug/lens';
import { getSessionId } from '@/lib/supabase/session';
import { formatKstTime } from '@/lib/time';
import { useLensStore } from '@/store/lensStore';
import { useSimStore } from '@/store/simulationStore';
import { useTraceStore } from '@/store/traceStore';
import type { EventType } from '@/types';

const TYPE_STYLE: Record<EventType, { color: string; prefix: string }> = {
  task: { color: '#60A5FA', prefix: '[TASK]' }, meeting: { color: '#34D399', prefix: '[MTG]' },
  chat: { color: '#F97316', prefix: '[CHAT]' }, review: { color: '#C084FC', prefix: '[REV]' },
  planning: { color: '#93C5FD', prefix: '[PLAN]' }, system: { color: '#94A3B8', prefix: '[SYS]' },
};
const RENDER_LIMIT = 200;

export default function EventLog() {
  const events = useSimStore(s => s.events);
  const tasks = useSimStore(s => s.tasks);
  const filters = useLensStore(s => s.filters);
  const clear = useLensStore(s => s.clear);
  const remote = useTraceStore(s => s.remoteTraces);
  const local = useTraceStore(s => s.localTraces);
  const imported = useTraceStore(s => s.importedBundle);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  const visible = events.slice(0, RENDER_LIMIT);
  const traces = imported?.traces ?? mergeTraces(remote, local);
  const filtered = filterEvents(visible, tasks, traces, filters, getSessionId());

  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0; }, [events.length]);

  return <div className={`event-log${collapsed ? ' event-log--collapsed' : ''}`}>
    <div className="panel-header">
      <div className="event-header-title"><span>📝 EVENT LOG</span><span className="panel-badge">{filtered.length}/{visible.length}</span></div>
      <button type="button" className="panel-collapse-btn" onClick={() => setCollapsed(value => !value)}>{collapsed ? '▼ SHOW' : '▲ HIDE'}</button>
    </div>
    {!collapsed && <div ref={scrollRef} className="panel-body event-log-body">
      {filtered.length === 0 && <div className="lens-empty">{visible.length ? 'No matching events.' : 'Waiting for events...'} <button type="button" onClick={clear}>Clear all</button></div>}
      {filtered.map(event => {
        const style = TYPE_STYLE[event.type] ?? TYPE_STYLE.system;
        return <div key={event.id} className="event-entry">
          <span className="event-time">{formatKstTime(event.timestamp)}</span>
          <span style={{ color: style.color, flexShrink: 0 }}>{style.prefix}</span>
          <span className="event-message"><HighlightedText text={event.message} query={filters.keyword} /></span>
        </div>;
      })}
    </div>}
  </div>;
}
