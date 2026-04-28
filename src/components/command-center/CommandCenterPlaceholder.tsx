'use client';

/**
 * CommandCenterPlaceholder — pixel-style agent workflow graph
 *
 * Shows the Planner → Architect → Developer → Reviewer → QA pipeline.
 * Nodes highlight when the corresponding agent is active.
 *
 * TODO: Replace with full React Flow implementation once wired to real LLM.
 * - Nodes:  React Flow <Handle> per role
 * - Edges:  animated dashed arrows showing message passing
 * - State:  AgentOps event stream drives node status colors
 */

import { useSimStore } from '@/store/simulationStore';
import type { AgentRole, AgentStatus } from '@/types';

const PIPELINE: { id: AgentRole; emoji: string; label: string }[] = [
  { id: 'planner',   emoji: '📋', label: 'Planner'   },
  { id: 'architect', emoji: '🏗️', label: 'Architect' },
  { id: 'developer', emoji: '💻', label: 'Dev'        },
  { id: 'reviewer',  emoji: '🔍', label: 'Reviewer'  },
  { id: 'qa',        emoji: '🧪', label: 'QA'         },
];

const ACTIVE_STATUSES: AgentStatus[] = ['coding', 'reviewing', 'testing', 'thinking', 'meeting'];

export default function CommandCenterPlaceholder() {
  const agents = useSimStore(s => s.agents);

  return (
    <div className="cmd-center">
      <div className="panel-header" style={{ height: 24 }}>
        <span>⬡ WORKFLOW GRAPH</span>
        <span className="panel-badge" style={{ fontSize: 8 }}>PLACEHOLDER</span>
      </div>

      <div className="cmd-flow">
        {PIPELINE.map((node, i) => {
          const agent   = agents[node.id];
          const isActive  = ACTIVE_STATUSES.includes(agent.status);
          const isBlocked = agent.status === 'blocked';

          return (
            <div key={node.id} style={{ display: 'flex', alignItems: 'center' }}>
              <div className="cmd-node">
                <div
                  className={`cmd-node-box ${isActive ? 'active' : ''} ${isBlocked ? 'blocked-node' : ''}`}
                  style={isActive ? { borderColor: agent.primaryColor, boxShadow: `0 0 6px ${agent.primaryColor}55` } : {}}
                  title={`${agent.name}: ${agent.status}`}
                >
                  <span style={{ fontSize: 14 }}>{node.emoji}</span>
                  {/* status dot */}
                  <div
                    style={{
                      position:     'absolute',
                      top:          2,
                      right:        2,
                      width:        5,
                      height:       5,
                      borderRadius: '50%',
                      background:   isBlocked ? '#EF4444' : isActive ? agent.primaryColor : '#1E293B',
                      boxShadow:    isActive && !isBlocked ? `0 0 4px ${agent.primaryColor}` : undefined,
                    }}
                  />
                </div>
                <div
                  className="cmd-node-label"
                  style={{ color: isActive ? agent.primaryColor : undefined }}
                >
                  {node.label}
                </div>
              </div>

              {i < PIPELINE.length - 1 && (
                <div className="cmd-arrow">→</div>
              )}
            </div>
          );
        })}
      </div>

      {/* future hook note */}
      <div style={{
        fontSize:    7,
        color:       '#1E293B',
        fontFamily:  'monospace',
        textAlign:   'center',
        paddingBottom: 6,
        letterSpacing: 0.5,
      }}>
        React Flow · LangGraph · AgentOps — coming soon
      </div>
    </div>
  );
}
