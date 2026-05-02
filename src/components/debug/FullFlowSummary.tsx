'use client';

import { useState } from 'react';
import { useDebugStore } from '@/store/debugStore';
import { formatKstTime } from '@/lib/time';

// ── Badge helpers ─────────────────────────────────────────────────────────────

function ApprovalBadge({ status }: { status: string | null }) {
  if (!status) return <span className="fsa-badge fsa-badge--pending">—</span>;
  if (status === 'approved')
    return <span className="fsa-badge fsa-badge--approved">approved</span>;
  if (status === 'changes_requested')
    return <span className="fsa-badge fsa-badge--changes">changes</span>;
  return <span className="fsa-badge fsa-badge--info">needs info</span>;
}

function QaBadge({ status }: { status: string | null }) {
  if (!status) return <span className="fsa-badge fsa-badge--pending">—</span>;
  if (status === 'passed')
    return <span className="fsa-badge fsa-badge--passed">passed</span>;
  if (status === 'failed')
    return <span className="fsa-badge fsa-badge--failed">failed</span>;
  return <span className="fsa-badge fsa-badge--needs-testing">needs testing</span>;
}

function PendingBadge() {
  return <span className="fsa-badge fsa-badge--pending">pending</span>;
}

// ── AgentRow ──────────────────────────────────────────────────────────────────

interface AgentRowProps {
  label: string;
  summary: string | null;
  badge?: React.ReactNode;
}

function AgentRow({ label, summary, badge }: AgentRowProps) {
  return (
    <div className="flow-summary-agent-row">
      <span className="fsa-label">{label}</span>
      <span className="fsa-summary" title={summary ?? ''}>
        {summary ?? <span style={{ color: '#475569' }}>—</span>}
      </span>
      {badge ?? null}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function FullFlowSummary() {
  const [collapsed, setCollapsed] = useState(false);
  const data = useDebugStore(s => s.fullFlowData);
  const retryFailedAgent = useDebugStore(s => s.retryFailedAgent);
  const retryingAgent = useDebugStore(s => s.retryingAgent);

  if (!data) return null;

  const { status } = data;
  const statusLabel =
    status === 'running'   ? 'RUNNING'   :
    status === 'completed' ? 'COMPLETED' : 'FAILED';

  const totalTokens = data.totalInputTokens + data.totalOutputTokens;

  return (
    <section className={`flow-summary${collapsed ? ' flow-summary--collapsed' : ''}`}>
      <div className="flow-summary-header">
        <button
          className="flow-summary-toggle"
          type="button"
          onClick={() => setCollapsed(v => !v)}
          aria-expanded={!collapsed}
        >
          <span>FULL FLOW SUMMARY</span>
          <span className={`flow-summary-status flow-summary-status--${status}`}>
            {statusLabel}
          </span>
        </button>
        <button
          className="trace-refresh-btn"
          type="button"
          onClick={() => setCollapsed(v => !v)}
          aria-label="접기/펼치기"
        >
          {collapsed ? 'OPEN' : 'CLOSE'}
        </button>
      </div>

      {!collapsed && (
        <div className="flow-summary-body">
          {/* Original request (if user provided one) */}
          {data.originalRequest && (
            <div className="flow-summary-request-row">
              <span className="fsa-label">Request</span>
              <span className="flow-summary-request-text" title={data.originalRequest}>
                {data.originalRequest}
              </span>
            </div>
          )}

          {/* Running indicator */}
          {status === 'running' && (
            <div className="flow-summary-running">
              <span>⏳</span>
              <span>실행 중... ({data.completedAgents.length}/5 완료)</span>
            </div>
          )}

          {/* Agent rows */}
          <AgentRow
            label="Planner"
            summary={data.plannerSummary}
            badge={data.plannerSummary ? undefined : <PendingBadge />}
          />
          <AgentRow
            label="Architect"
            summary={data.architectSummary}
            badge={data.architectSummary ? undefined : <PendingBadge />}
          />
          <AgentRow
            label="Developer"
            summary={data.developerSummary}
            badge={data.developerSummary ? undefined : <PendingBadge />}
          />
          <AgentRow
            label="Reviewer"
            summary={data.reviewerSummary}
            badge={<ApprovalBadge status={data.reviewerApprovalStatus} />}
          />
          <AgentRow
            label="QA"
            summary={data.qaSummary}
            badge={<QaBadge status={data.qaFinalStatus} />}
          />

          <div className="flow-summary-divider" />

          {/* Metrics */}
          <div className="flow-summary-metrics">
            <div>
              <span>totalLatencyMs</span>
              <strong>{data.totalLatencyMs > 0 ? `${data.totalLatencyMs}ms` : '—'}</strong>
            </div>
            <div>
              <span>totalInputTokens</span>
              <strong>{data.totalInputTokens > 0 ? data.totalInputTokens : '—'}</strong>
            </div>
            <div>
              <span>totalOutputTokens</span>
              <strong>{data.totalOutputTokens > 0 ? data.totalOutputTokens : '—'}</strong>
            </div>
            <div>
              <span>totalTokens</span>
              <strong>{totalTokens > 0 ? totalTokens : '—'}</strong>
            </div>
          </div>

          {/* Footer */}
          <div className="flow-summary-footer">
            <span>total tokens: {totalTokens > 0 ? totalTokens : '—'}</span>
            {data.completedAt && (
              <span>completed at {formatKstTime(data.completedAt)} KST</span>
            )}
          </div>

          {/* Mock fallback warning */}
          {data.mockFallbackAgents.length > 0 && (
            <div className="flow-summary-warning">
              <strong>Mock fallback used</strong>
              <span>{data.mockFallbackAgents.join(' / ')}</span>
            </div>
          )}

          {/* Failure block */}
          {status === 'failed' && data.failedAgent && (
            <div className="flow-summary-fail">
              <strong>⚠ {data.failedAgent} 실패: {data.failReason ?? '알 수 없는 오류'}</strong>
              {data.completedAgents.length > 0 && (
                <span className="flow-summary-completed-agents">
                  완료된 에이전트: {data.completedAgents.join(' → ')}
                </span>
              )}
              {data.completedAt && (
                <span>발생 시각: {formatKstTime(data.completedAt)} KST</span>
              )}
              {retryFailedAgent && (
                <button
                  className="flow-summary-retry"
                  type="button"
                  onClick={retryFailedAgent}
                  disabled={retryingAgent !== null}
                >
                  {retryingAgent ? 'Retrying...' : 'Retry Failed Agent'}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
