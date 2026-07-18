'use client';

/**
 * CommandCenterPlaceholder — pixel-style agent workflow graph
 *
 * Visualises the Planner → Architect → Developer → Reviewer → QA pipeline.
 * Active agents highlight their node with their primary colour + glow.
 *
 * TODO: Replace with React Flow when wired to real LLM (Milestone 4).
 */

import { useSimStore } from '@/store/simulationStore';
import type { AgentRole, AgentStatus } from '@/types';

const PIPELINE: { id: AgentRole; emoji: string; label: string }[] = [
  { id: 'planner',   emoji: '📋', label: 'Plan'  },
  { id: 'architect', emoji: '🏗️', label: 'Arch'  },
  { id: 'developer', emoji: '💻', label: 'Dev'   },
  { id: 'reviewer',  emoji: '🔍', label: 'Rev'   },
  { id: 'qa',        emoji: '🧪', label: 'QA'    },
];

const ACTIVE_STATUSES: AgentStatus[] = [
  'coding', 'reviewing', 'testing', 'thinking', 'meeting',
];

export default function CommandCenterPlaceholder() {
  const agents = useSimStore(s => s.agents);

  return (
    <div className="cmd-center">
      {/* header */}
      <div className="panel-header" style={{ height: 26, minHeight: 26 }}>
        <span>⬡ WORKFLOW</span>
        <span className="panel-badge" style={{ fontSize: 7 }}>PLACEHOLDER</span>
      </div>

      {/* pipeline flow */}
      <div className="cmd-flow">
        {PIPELINE.map((node, i) => {
          const agent     = agents[node.id];
          const isActive  = ACTIVE_STATUSES.includes(agent.status);
          const isBlocked = agent.status === 'blocked';

          const borderColor = isBlocked
            ? '#EF4444'
            : isActive
              ? agent.primaryColor
              : 'var(--border-bright)';

          const bgColor = isBlocked
            ? '#200505'
            : isActive
              ? `${agent.primaryColor}18`
              : '#0A0F1A';

          const glowShadow = isActive && !isBlocked
            ? `0 0 7px ${agent.primaryColor}66`
            : undefined;

          return (
            <div key={node.id} style={{ display: 'flex', alignItems: 'center' }}>
              <div className="cmd-node">
                <div
                  className="cmd-node-box"
                  style={{
                    borderColor,
                    background: bgColor,
                    boxShadow:  glowShadow,
                  }}
                  title={`${agent.name}: ${agent.status}`}
                >
                  <span style={{ fontSize: 13, lineHeight: 1 }}>{node.emoji}</span>

                  {/* status indicator dot */}
                  <div style={{
                    position:     'absolute',
                    top:          2,
                    right:        2,
                    width:        5,
                    height:       5,
                    borderRadius: '50%',
                    background:   isBlocked
                      ? '#EF4444'
                      : isActive
                        ? agent.primaryColor
                        : '#1E293B',
                    boxShadow: isActive && !isBlocked
                      ? `0 0 4px ${agent.primaryColor}`
                      : undefined,
                  }} />
                </div>

                <div
                  className="cmd-node-label"
                  style={{ color: isActive ? agent.primaryColor : undefined }}
                >
                  {node.label}
                </div>
              </div>

              {i < PIPELINE.length - 1 && (
                <div className="cmd-arrow">›</div>
              )}
            </div>
          );
        })}
      </div>

      {/* future integrations hint */}
      <div className="cmd-footer">
        React Flow · LangGraph · AgentOps — Milestone 4
      </div>
    </div>
  );
}
