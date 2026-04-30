'use client';

import { useState } from 'react';
import TaskQueue from '@/components/panels/TaskQueue';
import AgentStatus from '@/components/panels/AgentStatus';
import WorkflowGraph from '@/components/command-center/WorkflowGraph';
import FullFlowSummary from '@/components/debug/FullFlowSummary';
import DebugPanel from '@/components/debug/DebugPanel';
import AgentTraceViewer from '@/components/debug/AgentTraceViewer';
import { useDebugStore } from '@/store/debugStore';

type Tab = 'tasks' | 'flow' | 'debug' | 'traces';

const TABS: { id: Tab; label: string }[] = [
  { id: 'tasks',  label: 'TASKS'  },
  { id: 'flow',   label: 'FLOW'   },
  { id: 'debug',  label: 'DEBUG'  },
  { id: 'traces', label: 'TRACES' },
];

function EmptyState({ message }: { message: string }) {
  return (
    <div className="tab-empty-state">
      <span>{message}</span>
    </div>
  );
}

export default function RightPanel() {
  const [activeTab, setActiveTab] = useState<Tab>('tasks');

  const traceRefreshAt = useDebugStore(s => s.traceRefreshAt);
  const lastPlanAt     = useDebugStore(s => s.lastLlm.lastPlanAt);
  const fullFlowData   = useDebugStore(s => s.fullFlowData);
  const refreshKey     = Math.max(lastPlanAt ?? 0, traceRefreshAt ?? 0) || null;

  return (
    <aside className="right-panel">
      {/* ── Tab bar ── */}
      <nav className="right-panel-tabs" aria-label="Right panel tabs">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            className={`tab-btn${activeTab === id ? ' tab-btn--active' : ''}`}
            onClick={() => setActiveTab(id)}
            type="button"
            aria-current={activeTab === id ? 'true' : undefined}
          >
            {label}
          </button>
        ))}
      </nav>

      {/* ── Tab content ── */}
      <div className="right-panel-content">

        {/* Tasks — WorkflowGraph + TaskQueue + AgentStatus */}
        {activeTab === 'tasks' && (
          <>
            <WorkflowGraph />
            <TaskQueue />
            <AgentStatus />
          </>
        )}

        {/* Flow — Full Flow Summary */}
        {activeTab === 'flow' && (
          <>
            <FullFlowSummary />
            {!fullFlowData && (
              <EmptyState message="⚡ Run Full Flow를 실행하면 결과가 표시됩니다." />
            )}
          </>
        )}

        {/* Debug — Supabase / LLM status */}
        {activeTab === 'debug' && (
          <DebugPanel />
        )}

        {/* Traces — Agent Trace Viewer */}
        {activeTab === 'traces' && (
          <AgentTraceViewer refreshKey={refreshKey} />
        )}

      </div>
    </aside>
  );
}
