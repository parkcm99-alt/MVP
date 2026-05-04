'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { formatKstTime } from '@/lib/time';
import { useDebugStore, type FullFlowSummaryData } from '@/store/debugStore';

const DEFAULT_NEXT_ACTIONS = [
  '담당자별 후속 작업 확인',
  '리스크 항목 재검토',
  'QA 체크리스트 기준 최종 확인',
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
  '후속',
  '체크',
  'review',
  'test',
  'verify',
  'fix',
  'update',
  'implement',
  'confirm',
  'check',
];

const REPORT_HISTORY_KEY = 'ai-agent-office:report-history';
const REPORT_HISTORY_EVENT = 'ai-agent-office:report-history-updated';
const MAX_REPORT_HISTORY = 5;

const SUMMARY_KEYS = [
  'summary',
  'executiveSummary',
  'analysis',
  'result',
  'recommendation',
  'finalRecommendation',
  'message',
];

const ARRAY_KEYS = [
  'steps',
  'risks',
  'architectureNotes',
  'dataFlow',
  'implementationPlan',
  'filesToChange',
  'testPlan',
  'reviewFindings',
  'suggestedChanges',
  'testCases',
  'regressionChecks',
  'qualityRisks',
  'nextActions',
];

interface ReportBlock {
  text: string;
  bullets: string[];
}

interface FinalReport {
  title: string;
  originalRequest: string;
  executiveSummary: ReportBlock;
  planner: ReportBlock;
  architect: ReportBlock;
  developer: ReportBlock;
  reviewer: ReportBlock;
  qa: ReportBlock;
  finalRecommendation: string;
  nextActions: string[];
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalLatencyMs: number;
  completedAt: number | null;
  mockFallbackAgents: string[];
}

interface ReportHistoryItem {
  id: string;
  title: string;
  createdAt: number | null;
  report: FinalReport;
  markdown: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stripCodeFence(value: string): string {
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```(?:json|markdown|md)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function compactWhitespace(value: string): string {
  return value
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function maybeParseJson(value: string): unknown | null {
  const cleaned = stripCodeFence(value);
  const candidates = [
    cleaned,
    cleaned.replace(/\\"/g, '"'),
  ];

  const objectMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    candidates.push(objectMatch[0]);
    candidates.push(objectMatch[0].replace(/\\"/g, '"'));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Keep trying safer candidates.
    }
  }

  return null;
}

function humanizeString(value: string, depth = 0): string {
  const cleaned = compactWhitespace(stripCodeFence(value));
  if (depth >= 2) return cleaned;

  const parsed = maybeParseJson(cleaned);
  if (typeof parsed === 'string') return humanizeString(parsed, depth + 1);
  if (isRecord(parsed)) return parseRecordBlock(parsed).text;
  if (Array.isArray(parsed)) {
    const bullets: string[] = [];
    collectArrayItems(parsed, bullets);
    return bullets.join(' / ') || cleaned;
  }

  return cleaned;
}

function stringifyPrimitive(value: unknown): string | null {
  if (typeof value === 'string') return humanizeString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

function collectArrayItems(value: unknown, sink: string[]) {
  if (Array.isArray(value)) {
    value.forEach(item => {
      const primitive = stringifyPrimitive(item);
      if (primitive) sink.push(primitive);
      else if (isRecord(item)) {
        const nested = parseRecordBlock(item);
        if (nested.text) sink.push(nested.text);
        sink.push(...nested.bullets);
      }
    });
    return;
  }

  if (isRecord(value)) {
    Object.entries(value).forEach(([key, nested]) => {
      if (ARRAY_KEYS.includes(key)) collectArrayItems(nested, sink);
    });
  }
}

function findSummaryText(record: Record<string, unknown>): string | null {
  for (const key of SUMMARY_KEYS) {
    const value = stringifyPrimitive(record[key]);
    if (value) return value;
  }

  for (const value of Object.values(record)) {
    const primitive = stringifyPrimitive(value);
    if (primitive && primitive.length >= 8) return primitive;
  }

  return null;
}

function parseRecordBlock(record: Record<string, unknown>): ReportBlock {
  const bullets: string[] = [];
  Object.entries(record).forEach(([key, value]) => {
    if (ARRAY_KEYS.includes(key)) collectArrayItems(value, bullets);
  });

  return {
    text: findSummaryText(record) ?? '요약 문장이 없습니다.',
    bullets: Array.from(new Set(bullets)).slice(0, 8),
  };
}

function parseReportBlock(value: string | null, fallback: string): ReportBlock {
  if (!value?.trim()) {
    return { text: fallback, bullets: [] };
  }

  const cleaned = compactWhitespace(stripCodeFence(value));
  const parsed = maybeParseJson(cleaned);

  if (typeof parsed === 'string') {
    return parseReportBlock(parsed, fallback);
  }

  if (isRecord(parsed)) {
    return parseRecordBlock(parsed);
  }

  if (Array.isArray(parsed)) {
    const bullets: string[] = [];
    collectArrayItems(parsed, bullets);
    return {
      text: fallback,
      bullets: Array.from(new Set(bullets)).slice(0, 8),
    };
  }

  return {
    text: cleaned,
    bullets: [],
  };
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

function blockToText(block: ReportBlock): string {
  return [block.text, ...block.bullets].join(' ');
}

function buildNextActions(blocks: ReportBlock[]): string[] {
  const source = blocks.map(blockToText).join(' ');
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

function buildExecutiveSummary(
  data: FullFlowSummaryData,
  planner: ReportBlock,
  recommendation: string,
): ReportBlock {
  const reviewerStatus = data.reviewerApprovalStatus ?? 'unknown';
  const qaStatus = data.qaFinalStatus ?? 'unknown';

  return {
    text: `${planner.text} Reviewer 상태는 ${reviewerStatus}, QA 최종 상태는 ${qaStatus}입니다. 최종 권고는 "${recommendation}"입니다.`,
    bullets: [],
  };
}

function buildReport(data: FullFlowSummaryData): FinalReport | null {
  if (data.status !== 'completed') return null;

  const planner = parseReportBlock(data.plannerSummary, 'Planner 분석 요약이 없습니다.');
  const architect = parseReportBlock(data.architectSummary, 'Architect 구조/운영 검토 요약이 없습니다.');
  const developer = parseReportBlock(data.developerSummary, 'Developer 실행/구현 계획 요약이 없습니다.');
  const reviewer = parseReportBlock(data.reviewerSummary, 'Reviewer 검토 의견이 없습니다.');
  const qa = parseReportBlock(data.qaSummary, 'QA 검증 결과가 없습니다.');
  const finalRecommendation = buildFinalRecommendation(data);
  const totalTokens = data.totalInputTokens + data.totalOutputTokens;

  return {
    title: buildTitle(data),
    originalRequest: data.originalRequest?.trim() || '기존 최우선 태스크 기반 Full Flow 실행',
    executiveSummary: buildExecutiveSummary(data, planner, finalRecommendation),
    planner,
    architect,
    developer,
    reviewer: {
      text: reviewer.text,
      bullets: [...reviewer.bullets, `Approval Status: ${data.reviewerApprovalStatus ?? 'unknown'}`],
    },
    qa: {
      text: qa.text,
      bullets: [...qa.bullets, `Final Status: ${data.qaFinalStatus ?? 'unknown'}`],
    },
    finalRecommendation,
    nextActions: buildNextActions([planner, architect, developer, reviewer, qa]),
    totalInputTokens: data.totalInputTokens,
    totalOutputTokens: data.totalOutputTokens,
    totalTokens,
    totalLatencyMs: data.totalLatencyMs,
    completedAt: data.completedAt,
    mockFallbackAgents: data.mockFallbackAgents,
  };
}

function markdownBlock(block: ReportBlock): string[] {
  return [
    block.text,
    ...block.bullets.map(item => `- ${item}`),
  ];
}

function buildMarkdown(report: FinalReport): string {
  return [
    `# ${report.title}`,
    '',
    '## Original Request',
    report.originalRequest,
    '',
    '## Executive Summary',
    ...markdownBlock(report.executiveSummary),
    '',
    '## Planner 분석 요약',
    ...markdownBlock(report.planner),
    '',
    '## Architect 구조/운영 검토 요약',
    ...markdownBlock(report.architect),
    '',
    '## Developer 실행/구현 계획 요약',
    ...markdownBlock(report.developer),
    '',
    '## Reviewer 검토 의견',
    ...markdownBlock(report.reviewer),
    '',
    '## QA 검증 결과',
    ...markdownBlock(report.qa),
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
    report.mockFallbackAgents.length > 0 ? `- mockFallbackAgents: ${report.mockFallbackAgents.join(', ')}` : '- mockFallbackAgents: none',
  ].join('\n');
}

function parseReportHistory(raw: string | null): ReportHistoryItem[] {
  try {
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is ReportHistoryItem =>
        isRecord(item) &&
        typeof item.id === 'string' &&
        typeof item.title === 'string' &&
        isRecord(item.report) &&
        typeof item.markdown === 'string',
      )
      .slice(0, MAX_REPORT_HISTORY);
  } catch {
    return [];
  }
}

function getReportHistorySnapshot(): string {
  if (typeof window === 'undefined') return '[]';
  return window.localStorage.getItem(REPORT_HISTORY_KEY) ?? '[]';
}

function subscribeReportHistory(onStoreChange: () => void) {
  if (typeof window === 'undefined') return () => {};

  const onStorage = (event: StorageEvent) => {
    if (event.key === REPORT_HISTORY_KEY) onStoreChange();
  };
  window.addEventListener(REPORT_HISTORY_EVENT, onStoreChange);
  window.addEventListener('storage', onStorage);

  return () => {
    window.removeEventListener(REPORT_HISTORY_EVENT, onStoreChange);
    window.removeEventListener('storage', onStorage);
  };
}

function readReportHistory(): ReportHistoryItem[] {
  return parseReportHistory(getReportHistorySnapshot());
}

function writeReportHistory(history: ReportHistoryItem[]) {
  window.localStorage.setItem(
    REPORT_HISTORY_KEY,
    JSON.stringify(history.slice(0, MAX_REPORT_HISTORY)),
  );
  window.dispatchEvent(new Event(REPORT_HISTORY_EVENT));
}

function buildHistoryItem(report: FinalReport, markdown: string): ReportHistoryItem {
  const id = `${report.completedAt ?? report.title}-${report.totalTokens}-${report.totalLatencyMs}`;
  return {
    id,
    title: report.title,
    createdAt: report.completedAt,
    report,
    markdown,
  };
}

function buildMarkdownFilename(report: FinalReport): string {
  const date = report.completedAt ? new Date(report.completedAt) : new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  const stamp = [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join('');
  const time = `${pad(date.getHours())}${pad(date.getMinutes())}`;
  return `ai-agent-report-${stamp}-${time}.md`;
}

function ReportSection({ title, block }: { title: string; block: ReportBlock }) {
  return (
    <div className="final-report-section">
      <span>{title}</span>
      <p>{block.text}</p>
      {block.bullets.length > 0 && (
        <ul>
          {block.bullets.map(item => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function FinalReportPanel() {
  const [collapsed, setCollapsed] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const data = useDebugStore(s => s.fullFlowData);
  const report = useMemo(() => data ? buildReport(data) : null, [data]);
  const markdown = useMemo(() => report ? buildMarkdown(report) : '', [report]);
  const historySnapshot = useSyncExternalStore(
    subscribeReportHistory,
    getReportHistorySnapshot,
    () => '[]',
  );
  const history = useMemo(() => parseReportHistory(historySnapshot), [historySnapshot]);
  const selectedHistoryItem = history.find(item => item.id === selectedHistoryId) ?? null;
  const displayReport = selectedHistoryItem?.report ?? report;
  const displayMarkdown = selectedHistoryItem?.markdown ?? markdown;

  useEffect(() => {
    if (!report || !markdown) return;

    const item = buildHistoryItem(report, markdown);
    const current = readReportHistory();
    if (current[0]?.id === item.id) return;

    const next = [item, ...current.filter(historyItem => historyItem.id !== item.id)]
      .slice(0, MAX_REPORT_HISTORY);
    writeReportHistory(next);
  }, [report, markdown]);

  async function copyReport() {
    if (!displayReport) return;

    try {
      await navigator.clipboard.writeText(displayMarkdown);
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 1800);
    } catch {
      setCopyState('failed');
      window.setTimeout(() => setCopyState('idle'), 2200);
    }
  }

  function downloadMarkdown() {
    if (!displayReport) return;

    const blob = new Blob([displayMarkdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = buildMarkdownFilename(displayReport);
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function printReport() {
    window.print();
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
          <strong>{displayReport ? 'READY' : 'WAITING'}</strong>
        </button>
        <div className="final-report-header-actions">
          <button
            className="trace-refresh-btn"
            type="button"
            onClick={copyReport}
            disabled={!displayReport}
          >
            {copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Failed' : 'Copy Report'}
          </button>
          <button
            className="trace-refresh-btn"
            type="button"
            onClick={downloadMarkdown}
            disabled={!displayReport}
          >
            Download Markdown
          </button>
          <button
            className="trace-refresh-btn"
            type="button"
            onClick={printReport}
            disabled={!displayReport}
          >
            Print
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
      </div>

      {!collapsed && (
        <div className="final-report-body">
          {!displayReport && (
            <div className="final-report-empty">
              Run Full Flow to generate a report.
            </div>
          )}

          {displayReport && (
            <>
              <div className="final-report-title-card">
                <span>제목</span>
                <h3>{displayReport.title}</h3>
              </div>

              <div className="final-report-section">
                <span>Original Request</span>
                <p>{displayReport.originalRequest}</p>
              </div>
              <ReportSection title="Executive Summary" block={displayReport.executiveSummary} />
              <ReportSection title="Planner 분석 요약" block={displayReport.planner} />
              <ReportSection title="Architect 구조/운영 검토 요약" block={displayReport.architect} />
              <ReportSection title="Developer 실행/구현 계획 요약" block={displayReport.developer} />
              <ReportSection title="Reviewer 검토 의견" block={displayReport.reviewer} />
              <ReportSection title="QA 검증 결과" block={displayReport.qa} />

              <div className="final-report-recommendation">
                <span>Final Recommendation</span>
                <strong>{displayReport.finalRecommendation}</strong>
              </div>

              {displayReport.mockFallbackAgents.length > 0 && (
                <div className="final-report-warning">
                  <span>Mock fallback</span>
                  <strong>{displayReport.mockFallbackAgents.join(' / ')}</strong>
                </div>
              )}

              <div className="final-report-actions">
                <span>Next Actions</span>
                <ol>
                  {displayReport.nextActions.map(action => (
                    <li key={action}>{action}</li>
                  ))}
                </ol>
              </div>

              <div className="final-report-ops">
                <span>tokens {displayReport.totalTokens}</span>
                <span>input {displayReport.totalInputTokens}</span>
                <span>output {displayReport.totalOutputTokens}</span>
                <span>latency {displayReport.totalLatencyMs}ms</span>
                {displayReport.completedAt && <span>{formatKstTime(displayReport.completedAt)} KST</span>}
              </div>
            </>
          )}

          {history.length > 0 && (
            <div className="final-report-history">
              <div className="final-report-history-header">
                <span>Report History</span>
                <strong>localStorage · recent {history.length}</strong>
              </div>
              <div className="final-report-history-list">
                {history.map(item => (
                  <button
                    key={item.id}
                    className={`final-report-history-item${selectedHistoryId === item.id ? ' final-report-history-item--active' : ''}`}
                    type="button"
                    onClick={() => setSelectedHistoryId(item.id)}
                  >
                    <span>{item.title}</span>
                    <strong>{item.createdAt ? `${formatKstTime(item.createdAt)} KST` : 'draft'}</strong>
                  </button>
                ))}
                {selectedHistoryId && (
                  <button
                    className="final-report-history-clear"
                    type="button"
                    onClick={() => setSelectedHistoryId(null)}
                  >
                    Show latest report
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
