'use client';

import { useMemo, useState } from 'react';
import { formatKstTime } from '@/lib/time';
import { useDebugStore, type FullFlowSummaryData } from '@/store/debugStore';

const DEFAULT_NEXT_ACTIONS = [
  '담당자별 후속 작업 확인',
  '리스크 항목 재검토',
  'QA 체크리스트 기준으로 최종 확인',
];

const ACTION_KEYWORDS = [
  '해야',
  '필요',
  '확인',
  '검토',
  '진행',
  '수정',
  '보완',
  '테스트',
  '검증',
  'review',
  'test',
  'verify',
  'fix',
  'update',
  'implement',
  'confirm',
];

interface FinalReport {
  title: string;
  originalRequest: string;
  executiveSummary: string;
  planner: string;
  architect: string;
  developer: string;
  reviewer: string;
  qa: string;
  finalRecommendation: string;
  nextActions: string[];
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalLatencyMs: number;
  completedAt: number | null;
}

function cleanText(value: string | null): string {
  return value?.trim() || '아직 요약이 없습니다.';
}

function buildTitle(data: FullFlowSummaryData): string {
  const request = data.originalRequest?.trim();
  if (!request) return 'AI Agent Office Final Report';
  return `Final Report: ${request.slice(0, 34)}${request.length > 34 ? '...' : ''}`;
}

function buildFinalRecommendation(data: FullFlowSummaryData): string {
  if (data.reviewerApprovalStatus === 'changes_requested') return '수정 요청 반영 필요';
  if (data.reviewerApprovalStatus === 'needs_more_info') return '추가 정보 필요';
  if (data.qaFinalStatus === 'passed') return '진행 가능';
  if (data.qaFinalStatus === 'needs_more_testing') return '추가 검증 후 진행';
  if (data.qaFinalStatus === 'failed') return '수정 후 재검토';
  return '추가 검토 후 결정';
}

function splitSentences(text: string): string[] {
  return text
    .split(/[\n.!?。]+/g)
    .map(sentence => sentence.trim())
    .filter(sentence => sentence.length >= 8);
}

function buildNextActions(data: FullFlowSummaryData): string[] {
  const source = [
    data.plannerSummary,
    data.architectSummary,
    data.developerSummary,
    data.reviewerSummary,
    data.qaSummary,
  ]
    .filter(Boolean)
    .join(' ');

  const extracted = splitSentences(source)
    .filter(sentence => {
      const lower = sentence.toLowerCase();
      return ACTION_KEYWORDS.some(keyword => lower.includes(keyword));
    })
    .map(sentence => sentence.replace(/^[-*\d.)\s]+/, '').trim())
    .filter(Boolean);

  const unique = Array.from(new Set(extracted)).slice(0, 5);
  return unique.length > 0 ? unique : DEFAULT_NEXT_ACTIONS;
}

function buildExecutiveSummary(data: FullFlowSummaryData, recommendation: string): string {
  const reviewerStatus = data.reviewerApprovalStatus ?? 'unknown';
  const qaStatus = data.qaFinalStatus ?? 'unknown';
  const planner = cleanText(data.plannerSummary);
  return `${planner} Reviewer 상태는 ${reviewerStatus}, QA 최종 상태는 ${qaStatus}입니다. 최종 권고는 "${recommendation}"입니다.`;
}

function buildReport(data: FullFlowSummaryData): FinalReport | null {
  if (data.status !== 'completed') return null;

  const finalRecommendation = buildFinalRecommendation(data);
  const totalTokens = data.totalInputTokens + data.totalOutputTokens;

  return {
    title: buildTitle(data),
    originalRequest: data.originalRequest?.trim() || '기존 최우선 태스크 기반 Full Flow 실행',
    executiveSummary: buildExecutiveSummary(data, finalRecommendation),
    planner: cleanText(data.plannerSummary),
    architect: cleanText(data.architectSummary),
    developer: cleanText(data.developerSummary),
    reviewer: `${cleanText(data.reviewerSummary)} Approval: ${data.reviewerApprovalStatus ?? 'unknown'}.`,
    qa: `${cleanText(data.qaSummary)} Final status: ${data.qaFinalStatus ?? 'unknown'}.`,
    finalRecommendation,
    nextActions: buildNextActions(data),
    totalInputTokens: data.totalInputTokens,
    totalOutputTokens: data.totalOutputTokens,
    totalTokens,
    totalLatencyMs: data.totalLatencyMs,
    completedAt: data.completedAt,
  };
}

function buildMarkdown(report: FinalReport): string {
  return [
    `# ${report.title}`,
    '',
    '## Original Request',
    report.originalRequest,
    '',
    '## Executive Summary',
    report.executiveSummary,
    '',
    '## Planner 분석 요약',
    report.planner,
    '',
    '## Architect 구조/운영 검토 요약',
    report.architect,
    '',
    '## Developer 구현/자동화 계획 요약',
    report.developer,
    '',
    '## Reviewer 리스크/검토 의견',
    report.reviewer,
    '',
    '## QA 테스트/검증 체크리스트',
    report.qa,
    '',
    '## Final Recommendation',
    report.finalRecommendation,
    '',
    '## Next Actions',
    ...report.nextActions.map((action, index) => `${index + 1}. ${action}`),
    '',
    '## Operational Info',
    `- totalInputTokens: ${report.totalInputTokens}`,
    `- totalOutputTokens: ${report.totalOutputTokens}`,
    `- totalTokens: ${report.totalTokens}`,
    `- totalLatencyMs: ${report.totalLatencyMs}ms`,
    `- completedAt: ${report.completedAt ? `${formatKstTime(report.completedAt)} KST` : 'unknown'}`,
  ].join('\n');
}

function ReportSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="final-report-section">
      <span>{title}</span>
      <p>{children}</p>
    </div>
  );
}

export default function FinalReportPanel() {
  const [collapsed, setCollapsed] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const data = useDebugStore(s => s.fullFlowData);
  const report = useMemo(() => data ? buildReport(data) : null, [data]);

  async function copyReport() {
    if (!report) return;

    try {
      await navigator.clipboard.writeText(buildMarkdown(report));
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 1800);
    } catch {
      setCopyState('failed');
      window.setTimeout(() => setCopyState('idle'), 2200);
    }
  }

  return (
    <section className={`final-report${collapsed ? ' final-report--collapsed' : ''}`}>
      <div className="final-report-header">
        <button
          className="final-report-toggle"
          type="button"
          onClick={() => setCollapsed(value => !value)}
          aria-expanded={!collapsed}
        >
          <span>FINAL REPORT</span>
          <strong>{report ? 'READY' : 'WAITING'}</strong>
        </button>
        <button
          className="trace-refresh-btn"
          type="button"
          onClick={copyReport}
          disabled={!report}
        >
          {copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Failed' : 'Copy Report'}
        </button>
        <button
          className="trace-refresh-btn"
          type="button"
          onClick={() => setCollapsed(value => !value)}
          aria-label="접기/펼치기"
        >
          {collapsed ? 'OPEN' : 'CLOSE'}
        </button>
      </div>

      {!collapsed && (
        <div className="final-report-body">
          {!report && (
            <div className="final-report-empty">
              Run Full Flow to generate a report
            </div>
          )}

          {report && (
            <>
              <div className="final-report-title-card">
                <span>제목</span>
                <h3>{report.title}</h3>
              </div>

              <ReportSection title="Original Request">
                {report.originalRequest}
              </ReportSection>
              <ReportSection title="Executive Summary">
                {report.executiveSummary}
              </ReportSection>
              <ReportSection title="Planner 분석 요약">
                {report.planner}
              </ReportSection>
              <ReportSection title="Architect 구조/운영 검토 요약">
                {report.architect}
              </ReportSection>
              <ReportSection title="Developer 구현/자동화 계획 요약">
                {report.developer}
              </ReportSection>
              <ReportSection title="Reviewer 리스크/검토 의견">
                {report.reviewer}
              </ReportSection>
              <ReportSection title="QA 테스트/검증 체크리스트">
                {report.qa}
              </ReportSection>

              <div className="final-report-recommendation">
                <span>Final Recommendation</span>
                <strong>{report.finalRecommendation}</strong>
              </div>

              <div className="final-report-actions">
                <span>Next Actions</span>
                <ol>
                  {report.nextActions.map(action => (
                    <li key={action}>{action}</li>
                  ))}
                </ol>
              </div>

              <div className="final-report-ops">
                <span>tokens {report.totalTokens}</span>
                <span>input {report.totalInputTokens}</span>
                <span>output {report.totalOutputTokens}</span>
                <span>latency {report.totalLatencyMs}ms</span>
                {report.completedAt && <span>{formatKstTime(report.completedAt)} KST</span>}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
