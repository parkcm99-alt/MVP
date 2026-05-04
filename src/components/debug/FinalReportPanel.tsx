'use client';

import { useMemo, useState } from 'react';
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

function stringifyPrimitive(value: unknown): string | null {
  if (typeof value === 'string') return compactWhitespace(stripCodeFence(value));
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
  ].join('\n');
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
  const data = useDebugStore(s => s.fullFlowData);
  const report = useMemo(() => data ? buildReport(data) : null, [data]);
  const markdown = useMemo(() => report ? buildMarkdown(report) : '', [report]);

  async function copyReport() {
    if (!report) return;

    try {
      await navigator.clipboard.writeText(markdown);
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 1800);
    } catch {
      setCopyState('failed');
      window.setTimeout(() => setCopyState('idle'), 2200);
    }
  }

  function downloadMarkdown() {
    if (!report) return;

    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'ai-agent-report.md';
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
          <strong>{report ? 'READY' : 'WAITING'}</strong>
        </button>
        <div className="final-report-header-actions">
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
            onClick={downloadMarkdown}
            disabled={!report}
          >
            Download MD
          </button>
          <button
            className="trace-refresh-btn"
            type="button"
            onClick={printReport}
            disabled={!report}
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
          {!report && (
            <div className="final-report-empty">
              Run Full Flow to generate a report.
            </div>
          )}

          {report && (
            <>
              <div className="final-report-title-card">
                <span>제목</span>
                <h3>{report.title}</h3>
              </div>

              <div className="final-report-section">
                <span>Original Request</span>
                <p>{report.originalRequest}</p>
              </div>
              <ReportSection title="Executive Summary" block={report.executiveSummary} />
              <ReportSection title="Planner 분석 요약" block={report.planner} />
              <ReportSection title="Architect 구조/운영 검토 요약" block={report.architect} />
              <ReportSection title="Developer 실행/구현 계획 요약" block={report.developer} />
              <ReportSection title="Reviewer 검토 의견" block={report.reviewer} />
              <ReportSection title="QA 검증 결과" block={report.qa} />

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
