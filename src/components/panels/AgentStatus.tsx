'use client';

import { useSimStore } from '@/store/simulationStore';
import type { AgentStatus } from '@/types';

const STATUS_META: Record<AgentStatus, { icon: string; color: string; label: string }> = {
  idle:      { icon: '💤', color: '#64748B', label: 'Idle'      },
  walking:   { icon: '🚶', color: '#F97316', label: 'Moving'    },
  thinking:  { icon: '🤔', color: '#C084FC', label: 'Thinking'  },
  coding:    { icon: '💻', color: '#60A5FA', label: 'Coding'    },
  reviewing: { icon: '🔍', color: '#34D399', label: 'Reviewing' },
  testing:   { icon: '🧪', color: '#FB923C', label: 'Testing'   },
  meeting:   { icon: '💬', color: '#38BDF8', label: 'Meeting'   },
  blocked:   { icon: '⛔', color: '#EF4444', label: 'Blocked'   },
};

export default function AgentStatus() {
  const agents = useSimStore(s => s.agents);

  return (
    <div className="agent-status-panel">
      <div className="panel-header">
        <span>📊 AGENT STATUS</span>
      </div>
      <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {Object.values(agents).map(agent => {
          const meta = STATUS_META[agent.status];
          return (
            <div
              key={agent.id}
              style={{
                display:      'flex',
                alignItems:   'center',
                gap:          8,
                background:   agent.status === 'blocked' ? '#2D050580' : '#1E293B',
                border:       `1px solid ${agent.status === 'blocked' ? '#EF444466' : agent.primaryColor + '33'}`,
                borderLeft:   `3px solid ${agent.status === 'blocked' ? '#EF4444' : agent.primaryColor}`,
                borderRadius: 3,
                padding:      '6px 8px',
              }}
            >
              {/* avatar */}
              <div
                style={{
                  width:          28,
                  height:         28,
                  background:     agent.primaryColor + '22',
                  border:         `1px solid ${agent.primaryColor}`,
                  borderRadius:   2,
                  display:        'flex',
                  alignItems:     'center',
                  justifyContent: 'center',
                  fontSize:       16,
                  flexShrink:     0,
                }}
              >
                {agent.emoji}
              </div>

              {/* info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 10, color: agent.primaryColor, fontFamily: 'monospace', fontWeight: 'bold' }}>
                    {agent.name.toUpperCase()}
                  </span>
                  <span style={{ fontSize: 9, color: meta.color, fontFamily: 'monospace' }}>
                    {meta.icon} {meta.label}
                  </span>
                </div>
                <div
                  style={{
                    fontSize:     9,
                    color:        '#475569',
                    fontFamily:   'monospace',
                    marginTop:    2,
                    overflow:     'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace:   'nowrap',
                  }}
                >
                  {agent.currentTask ?? (agent.speech ? `"${agent.speech}"` : '—')}
                </div>
              </div>

              {/* completed badge */}
              {agent.completedTasks > 0 && (
                <div
                  style={{
                    fontSize:     8,
                    fontFamily:   'monospace',
                    color:        '#34D399',
                    background:   '#14261E',
                    border:       '1px solid #34D39966',
                    borderRadius: 2,
                    padding:      '1px 4px',
                    flexShrink:   0,
                  }}
                >
                  ✓{agent.completedTasks}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
