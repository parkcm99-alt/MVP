'use client';

import { useMemo, useCallback, useState } from 'react';
import {
  ReactFlow,
  Handle,
  Position,
  Background,
  MarkerType,
  type Node,
  type Edge,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useSimStore } from '@/store/simulationStore';
import type { AgentRole } from '@/types';

// ── node data shape ────────────────────────────────────────────────────────────

type AgentNodeData = {
  agentRole: AgentRole;
  emoji:     string;
  label:     string;
};

type AgentFlowNode = Node<AgentNodeData, 'agentNode'>;

// ── active status set ──────────────────────────────────────────────────────────

const ACTIVE_STATUSES = new Set([
  'coding', 'reviewing', 'testing', 'thinking', 'meeting',
]);

// ── custom node component ──────────────────────────────────────────────────────

function AgentWorkflowNode({ data, selected }: NodeProps<AgentFlowNode>) {
  const agent = useSimStore(s => s.agents[data.agentRole]);

  const isActive  = ACTIVE_STATUSES.has(agent.status);
  const isBlocked = agent.status === 'blocked';

  const borderColor = isBlocked
    ? '#EF4444'
    : selected
      ? '#CBD5E1'
      : isActive
        ? agent.primaryColor
        : '#334155';

  const bgColor = isBlocked
    ? '#1F0404'
    : isActive
      ? `${agent.primaryColor}1A`
      : '#06090F';

  const boxShadow = selected
    ? `0 0 0 1px #CBD5E140, 0 0 10px ${agent.primaryColor}44`
    : isActive && !isBlocked
      ? `0 0 8px ${agent.primaryColor}44`
      : undefined;

  return (
    <>
      <Handle
        type="target"
        position={Position.Left}
        style={{ opacity: 0, width: 1, height: 1, minWidth: 1, minHeight: 1 }}
      />

      {/* top-center handle for the backward QA→Dev edge */}
      <Handle
        id="top"
        type="target"
        position={Position.Top}
        style={{ opacity: 0, width: 1, height: 1, minWidth: 1, minHeight: 1 }}
      />
      <Handle
        id="top-src"
        type="source"
        position={Position.Top}
        style={{ opacity: 0, width: 1, height: 1, minWidth: 1, minHeight: 1 }}
      />

      <div
        style={{
          width:          46,
          height:         40,
          background:     bgColor,
          border:         `1.5px solid ${borderColor}`,
          borderRadius:   2,
          display:        'flex',
          flexDirection:  'column',
          alignItems:     'center',
          justifyContent: 'center',
          gap:            2,
          boxShadow,
          fontFamily:     "'Courier New', monospace",
          transition:     'border-color 0.25s, background 0.25s, box-shadow 0.25s',
          position:       'relative',
          cursor:         'pointer',
        }}
      >
        <span style={{ fontSize: 13, lineHeight: 1 }}>{data.emoji}</span>
        <span style={{
          fontSize:   6,
          letterSpacing: 0.4,
          color:      isBlocked ? '#EF4444' : isActive ? agent.primaryColor : '#475569',
          fontWeight: 'bold',
        }}>
          {data.label}
        </span>

        {/* status dot */}
        <div style={{
          position:     'absolute',
          top:          3,
          right:        3,
          width:        4,
          height:       4,
          borderRadius: '50%',
          background:   isBlocked
            ? '#EF4444'
            : isActive
              ? agent.primaryColor
              : '#1E293B',
          boxShadow: isActive && !isBlocked
            ? `0 0 3px ${agent.primaryColor}`
            : undefined,
        }} />
      </div>

      <Handle
        type="source"
        position={Position.Right}
        style={{ opacity: 0, width: 1, height: 1, minWidth: 1, minHeight: 1 }}
      />
    </>
  );
}

// defined outside component — prevents re-registration on every render
const NODE_TYPES: NodeTypes = { agentNode: AgentWorkflowNode };

// ── pipeline definition ────────────────────────────────────────────────────────

const PIPELINE: { id: AgentRole; emoji: string; label: string }[] = [
  { id: 'planner',   emoji: '📋', label: 'Plan' },
  { id: 'architect', emoji: '🏗️', label: 'Arch' },
  { id: 'developer', emoji: '💻', label: 'Dev'  },
  { id: 'reviewer',  emoji: '🔍', label: 'Rev'  },
  { id: 'qa',        emoji: '🧪', label: 'QA'   },
];

// node positions — never change; visual state comes from store inside the node
const STATIC_NODES: AgentFlowNode[] = PIPELINE.map((p, i) => ({
  id:         p.id,
  type:       'agentNode',
  position:   { x: 10 + i * 54, y: 28 },
  data:       { agentRole: p.id, emoji: p.emoji, label: p.label },
  draggable:  false,
  selectable: true,
}));

// ── edge style helpers ─────────────────────────────────────────────────────────

function forwardEdge(
  id: string,
  source: AgentRole,
  target: AgentRole,
  animated: boolean,
): Edge {
  return {
    id,
    source,
    target,
    type:      'smoothstep',
    animated,
    markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12, color: animated ? '#475569' : '#1E293B' },
    style:     { stroke: animated ? '#475569' : '#1E293B', strokeWidth: 1.5 },
  };
}

// ── main component ─────────────────────────────────────────────────────────────

export default function WorkflowGraph() {
  const agents = useSimStore(s => s.agents);
  const events = useSimStore(s => s.events);
  const [selectedAgent, setSelectedAgent] = useState<AgentRole | null>(null);

  // "bug found" state: developer blocked OR recent review event from QA
  const isBugFound = useMemo(() =>
    agents.developer.status === 'blocked' ||
    events.slice(0, 10).some(e => e.agentId === 'qa' && e.type === 'review'),
    [agents.developer.status, events],
  );

  const edges = useMemo<Edge[]>(() => [
    forwardEdge('e1', 'planner',   'architect', ACTIVE_STATUSES.has(agents.architect.status)),
    forwardEdge('e2', 'architect', 'developer', ACTIVE_STATUSES.has(agents.developer.status)),
    forwardEdge('e3', 'developer', 'reviewer',  ACTIVE_STATUSES.has(agents.reviewer.status)),
    forwardEdge('e4', 'reviewer',  'qa',        ACTIVE_STATUSES.has(agents.qa.status)),
    // QA → Developer: bug re-route edge
    {
      id:           'e-bug',
      source:       'qa',
      target:       'developer',
      sourceHandle: 'top-src',
      targetHandle: 'top',
      type:         'smoothstep',
      animated:     isBugFound,
      label:        isBugFound ? '🐛 bug' : undefined,
      labelStyle:   { fill: '#EF4444', fontSize: 6, fontFamily: "'Courier New', monospace", fontWeight: 'bold' },
      labelBgStyle: { fill: '#1A0404', fillOpacity: 0.95 },
      labelBgPadding: [3, 2] as [number, number],
      style: {
        stroke:          isBugFound ? '#EF4444' : '#1E293B',
        strokeWidth:     isBugFound ? 2 : 1,
        strokeDasharray: isBugFound ? undefined : '3 4',
      },
      markerEnd: {
        type:   MarkerType.ArrowClosed,
        width:  12,
        height: 12,
        color:  isBugFound ? '#EF4444' : '#1E293B',
      },
    },
  ], [agents, isBugFound]);

  const onNodeClick = useCallback((_evt: React.MouseEvent, node: Node) => {
    setSelectedAgent(prev => prev === (node.id as AgentRole) ? null : (node.id as AgentRole));
  }, []);

  const sel = selectedAgent ? agents[selectedAgent] : null;

  return (
    <div className="cmd-center">
      {/* header */}
      <div className="panel-header" style={{ height: 26, minHeight: 26 }}>
        <span>⬡ WORKFLOW</span>
        <span className="panel-badge" style={{ fontSize: 7 }}>REACT FLOW</span>
      </div>

      {/* graph area */}
      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        <ReactFlow
          nodes={STATIC_NODES}
          edges={edges}
          nodeTypes={NODE_TYPES}
          fitView
          fitViewOptions={{ padding: 0.25, minZoom: 0.5, maxZoom: 1.2 }}
          panOnDrag={false}
          panOnScroll={false}
          zoomOnScroll={false}
          zoomOnPinch={false}
          zoomOnDoubleClick={false}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          onNodeClick={onNodeClick}
          proOptions={{ hideAttribution: true }}
          style={{ background: '#06090F' }}
        >
          <Background color="#1A2234" gap={16} size={0.5} />
        </ReactFlow>

        {/* selected agent tooltip */}
        {sel && (
          <div className="wf-tooltip" onClick={e => e.stopPropagation()}>
            <div className="wf-tooltip-header">
              <span style={{ color: sel.primaryColor }}>
                {sel.emoji} {sel.name.toUpperCase()}
              </span>
              <button
                className="card-close"
                onClick={() => setSelectedAgent(null)}
                style={{ fontSize: 8, padding: '0 4px', lineHeight: 1.4 }}
              >
                ✕
              </button>
            </div>
            <div className="wf-tooltip-row">
              <span className="wf-tooltip-label">Status</span>
              <span style={{ color: '#94A3B8' }}>{sel.status}</span>
            </div>
            {sel.currentTask && (
              <div className="wf-tooltip-row">
                <span className="wf-tooltip-label">Task</span>
                <span style={{ color: '#94A3B8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 110 }}>
                  {sel.currentTask}
                </span>
              </div>
            )}
            <div className="wf-tooltip-row">
              <span className="wf-tooltip-label">Done</span>
              <span style={{ color: '#34D399' }}>✓ {sel.completedTasks}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
