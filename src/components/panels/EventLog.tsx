'use client';

import { useEffect, useRef, useState } from 'react';
import HighlightText from '@/components/debug/HighlightText';
import { useOperationsLens } from '@/hooks/useOperationsLens';
import { isLensActive } from '@/lib/debug/operationsLens';
import { formatKstTime } from '@/lib/time';
import { useDebugStore } from '@/store/debugStore';
import type { EventType } from '@/types';

const TYPE_STYLE: Record<EventType, { color: string; prefix: string }> = {
  task: { color: '#60A5FA', prefix: '[TASK]' }, meeting: { color: '#34D399', prefix: '[MTG]' },
  chat: { color: '#F97316', prefix: '[CHAT]' }, review: { color: '#C084FC', prefix: '[REV]' },
  planning: { color: '#93C5FD', prefix: '[PLAN]' }, system: { color: '#94A3B8', prefix: '[SYS]' },
};
const RENDER_LIMIT = 200;

export default function EventLog() {
  const { liveEvents: filtered, liveEventTotal, filters } = useOperationsLens();
  const clearFilters = useDebugStore(state => state.clearFilters);
  const events = filtered.slice(0, RENDER_LIMIT);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0; }, [filtered.length]);

  return <div className={`event-log${collapsed ? ' event-log--collapsed' : ''}`}>
    <div className="panel-header">
      <div className="panel-header-tools"><span>📝 EVENT LOG</span><span className="panel-badge">{filtered.length}/{liveEventTotal}</span>
        {isLensActive(filters) && <button type="button" className="panel-clear-btn" onClick={clearFilters}>CLEAR</button>}</div>
      <button className="panel-collapse-btn" type="button" onClick={() => setCollapsed(value => !value)}>{collapsed ? '▼ SHOW' : '▲ HIDE'}</button>
    </div>
    {!collapsed && <div ref={scrollRef} className="panel-body event-log-body">
      {events.length === 0 && <div className="lens-empty">{liveEventTotal === 0 ? 'Waiting for events...' : 'No events match Operations Lens.'}
        {isLensActive(filters) && <button type="button" onClick={clearFilters}>Clear all</button>}</div>}
      {events.map(event => {
        const style = TYPE_STYLE[event.type] ?? TYPE_STYLE.system;
        return <div className="event-row" key={event.id}>
          <time>{formatKstTime(event.timestamp)}</time><span style={{ color: style.color }}>{style.prefix}</span>
          <span className="event-message"><HighlightText text={event.message} query={filters.keyword} />{event.localOnly && <em> LOCAL</em>}</span>
        </div>;
      })}
      {filtered.length > RENDER_LIMIT && <div className="event-limit-note">Showing newest {RENDER_LIMIT} of {filtered.length} matches.</div>}
    </div>}
  </div>;
}
