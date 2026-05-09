'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { formatKstTime } from '@/lib/time';
import { formatBytes, type WorkRequestAttachment } from '@/lib/work-request/attachments';
import { useDebugStore, type FullFlowSummaryData } from '@/store/debugStore';
import { useSimStore } from '@/store/simulationStore';
import type { RequestAnalysisMode } from '@/lib/agents/requestMode';
import type { NotifyChannel, NotifyStatusResponse } from '@/lib/notify/types';

const DEFAULT_NEXT_ACTIONS = [
  '담당자별 후속 작업 확인',
  '리스크 항목 재검토',
  'QA 체크리스트 기준 최종 확인',
];

const REPORT_HISTORY_KEY = 'ai-agent-office:report-history:v4';
const REPORT_HISTORY_EVENT = 'ai-agent-office:report-history-updated';
const MAX_REPORT_HISTORY = 5;
const PARSE_WARNING = '해당 Agent 결과 일부를 정리하지 못했습니다. Summary 기준으로 요약합니다.';

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

const JSON_STATUS_KEYS = [
  'approvalStatus',
  'finalStatus',
  'nextAgent',
  'provider',
  'role',
  'ok',
];

const JSON_KEY_PATTERN = new RegExp(
  `"?(?:${[...SUMMARY_KEYS, ...ARRAY_KEYS, ...JSON_STATUS_KEYS].join('|')})"?\\s*:`,
  'i',
);
const RAW_KEY_NAME_PATTERN = new RegExp(`\\b(?:${ARRAY_KEYS.join('|')})\\b`, 'i');
const INTERNAL_TECH_PATTERN = /\b(?:Next\.js|Nextjs|Supabase|API route|src\/components|src\/lib|npm run lint|npm run build|mock workflow|DB migration)\b/gi;

const KNOWN_JSON_KEYS = new Set([
  ...SUMMARY_KEYS,
  ...ARRAY_KEYS,
  ...JSON_STATUS_KEYS,
]);

interface ReportBlock {
  text: string;
  bullets: string[];
}

interface FinalReport {
  mode: RequestAnalysisMode;
  title: string;
  originalRequest: string;
  attachments: WorkRequestAttachment[];
  executiveSummary: ReportBlock;
  planner: ReportBlock;
  architect: ReportBlock;
  developer: ReportBlock;
  reviewer: ReportBlock;
  qa: ReportBlock;
  businessSections?: {
    coreIdea: ReportBlock;
    revenueModel: ReportBlock;
    customerAcquisition: ReportBlock;
    risks: ReportBlock;
    operationsAutomation: ReportBlock;
    pilotChecklist: ReportBlock;
  };
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

function looksLikeJson(value: string): boolean {
  const cleaned = compactWhitespace(stripCodeFence(value));
  return JSON_KEY_PATTERN.test(cleaned) || /^[{[]/.test(cleaned);
}

function safeParseAgentContent(value: unknown, depth = 0): unknown {
  if (depth >= 5) return value;

  if (Array.isArray(value)) {
    return value.map(item => safeParseAgentContent(item, depth + 1));
  }

  if (isRecord(value)) {
    const summary = value.summary;
    if (typeof summary === 'string' && looksLikeJson(summary)) {
      const nested = safeParseAgentContent(summary, depth + 1);
      if (isRecord(nested)) {
        return {
          ...value,
          ...nested,
          summary: typeof nested.summary === 'string' ? nested.summary : value.summary,
        };
      }
    }

    return value;
  }

  if (typeof value !== 'string') return value;

  const cleaned = compactWhitespace(stripCodeFence(value));
  if (!cleaned) return '';

  const parsed = maybeParseJson(cleaned);
  if (parsed === null) return cleaned;

  return safeParseAgentContent(parsed, depth + 1);
}

function decodeJsonStringLiteral(value: string): string {
  try {
    return JSON.parse(`"${value.replace(/"/g, '\\"')}"`);
  } catch {
    return value;
  }
}

function extractQuotedValues(value: string): string[] {
  return Array.from(value.matchAll(/"((?:\\.|[^"\\])*)"/g))
    .map(match => decodeJsonStringLiteral(match[1]).trim())
    .filter(item =>
      item.length >= 6 &&
      !KNOWN_JSON_KEYS.has(item) &&
      !/^(true|false|null|mock|claude|planner|architect|developer|reviewer|qa|approved|changes_requested|needs_more_info|passed|failed|needs_more_testing)$/i.test(item),
    );
}

function sentenceFallback(value: string, fallback: string): string {
  const cleaned = compactWhitespace(stripCodeFence(value));
  if (!cleaned) return fallback;

  if (looksLikeJson(cleaned)) {
    const quotedValues = extractQuotedValues(cleaned);
    if (quotedValues.length > 0) {
      return sanitizeReportText(quotedValues.slice(0, 2).join(' '));
    }
    return fallback;
  }

  const sentences = splitSentences(cleaned);
  const safeText = sentences.length > 0 ? sentences.slice(0, 2).join(' ') : cleaned;
  const sanitized = sanitizeReportText(safeText);
  return sanitized.length > 180 ? `${sanitized.slice(0, 180).trim()}...` : sanitized;
}

function sanitizeReportText(value: string): string {
  return value
    .replace(RAW_KEY_NAME_PATTERN, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.!?。])/g, '$1')
    .trim();
}

function sanitizeBusinessText(value: string): string {
  return sanitizeReportText(value)
    .replace(INTERNAL_TECH_PATTERN, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.!?。])/g, '$1')
    .trim();
}

function sanitizeBusinessBlock(block: ReportBlock, fallback: string): ReportBlock {
  const text = sanitizeBusinessText(block.text) || fallback;
  const bullets = block.bullets
    .map(sanitizeBusinessText)
    .filter(Boolean);

  return {
    text,
    bullets: Array.from(new Set(bullets)).slice(0, 10),
  };
}

function humanizeString(value: string, fallback = '요약 문장이 없습니다.', depth = 0): string {
  const cleaned = compactWhitespace(stripCodeFence(value));
  if (depth >= 3) return sentenceFallback(cleaned, fallback);

  const parsed = safeParseAgentContent(cleaned);
  if (typeof parsed === 'string' && parsed !== cleaned) return humanizeString(parsed, fallback, depth + 1);
  if (typeof parsed === 'string') return sentenceFallback(parsed, fallback);
  if (isRecord(parsed)) return parseRecordBlock(parsed).text;
  if (Array.isArray(parsed)) {
    const bullets: string[] = [];
    collectArrayItems(parsed, bullets);
    return bullets.slice(0, 2).join(' ') || fallback;
  }

  return sentenceFallback(cleaned, fallback);
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
  const parsed = safeParseAgentContent(cleaned);
  const parseFailed = looksLikeJson(cleaned) && typeof parsed === 'string';

  if (typeof parsed === 'string' && parsed !== cleaned) {
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
    text: sentenceFallback(cleaned, fallback),
    bullets: parseFailed ? [PARSE_WARNING] : [],
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

function cleanList(items: Array<string | null | undefined>): string[] {
  return Array.from(new Set(
    items
      .map(item => item ? humanizeString(item, '') : '')
      .map(item => item.replace(/^[-*\d.)\s]+/, '').trim())
      .map(sanitizeReportText)
      .filter(item => item.length > 0 && !JSON_KEY_PATTERN.test(item) && !RAW_KEY_NAME_PATTERN.test(item)),
  ));
}

function buildStructuredBlock(
  summary: string | null | undefined,
  fallback: string,
  groups: Array<Array<string | null | undefined>>,
): ReportBlock {
  const parsed = parseReportBlock(summary ?? null, fallback);
  const bullets = cleanList([
    ...parsed.bullets,
    ...groups.flat(),
  ]).filter(item => item !== parsed.text);

  return {
    text: humanizeString(parsed.text, fallback),
    bullets: bullets.slice(0, 10),
  };
}

function buildNextActions(data: FullFlowSummaryData): string[] {
  const developerActions = cleanList(data.developerReport?.implementationPlan ?? []).slice(0, 2);
  const reviewerActions = cleanList(data.reviewerReport?.suggestedChanges ?? []).slice(0, 2);
  const qaSource = (data.qaReport?.testCases?.length ?? 0) > 0
    ? data.qaReport?.testCases
    : data.qaReport?.regressionChecks;
  const qaActions = cleanList(qaSource ?? []).slice(0, 2);
  const actions = [...developerActions, ...reviewerActions, ...qaActions].slice(0, 6);

  return actions.length > 0 ? actions : DEFAULT_NEXT_ACTIONS;
}

function filterBusinessItems(items: string[], keywords: string[]): string[] {
  const normalizedKeywords = keywords.map(keyword => keyword.toLowerCase());
  return items.filter(item => {
    const normalized = item.toLowerCase();
    return normalizedKeywords.some(keyword => normalized.includes(keyword));
  });
}

function buildBusinessRequestSignals(request: string | null) {
  const normalized = request?.toLowerCase() ?? '';

  return {
    coreIdea: [
      /ai\s*dsp|dsp/.test(normalized)
        ? 'AI DSP 플랫폼 방향성은 B2B 고객의 광고 운영 효율과 성과 검증을 중심으로 정리합니다.'
        : null,
    ],
    revenue: [
      /구독|subscription/.test(normalized)
        ? '구독료 모델은 반복 매출과 고객 유지 가능성을 검증하는 축으로 봅니다.'
        : null,
      /프로레타|pro-rata|pro rata/.test(normalized)
        ? '프로레타 모델은 사용량 또는 성과 기여도에 맞춘 과금 구조로 검토합니다.'
        : null,
    ],
    customer: [
      /b2b/.test(normalized)
        ? 'B2B 초기 고객 확보는 명확한 문제를 가진 소규모 고객군 파일럿부터 시작합니다.'
        : null,
    ],
    risk: [
      /광고비|cac/.test(normalized)
        ? '광고비와 CAC가 초기 매출보다 빠르게 커지는 리스크를 별도로 관리해야 합니다.'
        : null,
    ],
    operations: [
      /spotify/.test(normalized)
        ? 'Spotify API 활용 가능성은 데이터 확보, 타깃팅 인사이트, 성과 측정 관점에서 파일럿 범위로 검토합니다.'
        : null,
    ],
    pilot: [
      /파일럿|pilot/.test(normalized)
        ? '초기 파일럿은 고객 반응, 지불 의사, 성과 지표를 짧은 주기로 검증합니다.'
        : null,
    ],
  };
}

function formatApprovalStatus(status: FullFlowSummaryData['reviewerApprovalStatus']): string {
  if (status === 'approved') return '승인';
  if (status === 'changes_requested') return '수정 요청';
  if (status === 'needs_more_info') return '추가 정보 필요';
  return '미확인';
}

function formatQaStatus(status: FullFlowSummaryData['qaFinalStatus']): string {
  if (status === 'passed') return '통과';
  if (status === 'failed') return '실패';
  if (status === 'needs_more_testing') return '추가 검증 필요';
  return '미확인';
}

function summarizeOriginalRequest(request: string | null): string {
  const summary = request?.trim()
    ? sentenceFallback(request, '').slice(0, 140)
    : '';

  return summary
    ? `요청은 "${summary}" 기준으로 분석했습니다.`
    : '기존 최우선 태스크를 기준으로 전체 워크플로우를 실행했습니다.';
}

function buildExecutiveSummary(
  data: FullFlowSummaryData,
  planner: ReportBlock,
  architect: ReportBlock,
  developer: ReportBlock,
  recommendation: string,
): ReportBlock {
  return {
    text: [
      summarizeOriginalRequest(data.originalRequest),
      planner.text,
      architect.text || developer.text,
      `Reviewer 검토 상태는 ${formatApprovalStatus(data.reviewerApprovalStatus)}이고 QA 검증 상태는 ${formatQaStatus(data.qaFinalStatus)}입니다.`,
      `최종 권고는 "${recommendation}"입니다.`,
    ].filter(Boolean).slice(0, 5).join(' '),
    bullets: [],
  };
}

function buildBusinessSections(data: FullFlowSummaryData) {
  const requestSignals = buildBusinessRequestSignals(data.originalRequest);
  const plannerItems = cleanList([
    ...requestSignals.coreIdea,
    ...(data.plannerReport?.steps ?? []),
    ...(data.plannerReport?.risks ?? []),
  ]);
  const architectItems = cleanList([
    ...(data.architectReport?.architectureNotes ?? []),
    ...(data.architectReport?.dataFlow ?? []),
    ...(data.architectReport?.risks ?? []),
  ]);
  const developerItems = cleanList([
    ...requestSignals.operations,
    ...(data.developerReport?.implementationPlan ?? []),
    ...(data.developerReport?.filesToChange ?? []),
    ...(data.developerReport?.testPlan ?? []),
    ...(data.developerReport?.risks ?? []),
  ]);
  const reviewerItems = cleanList([
    ...(data.reviewerReport?.reviewFindings ?? []),
    ...(data.reviewerReport?.suggestedChanges ?? []),
    ...(data.reviewerReport?.risks ?? []),
  ]);
  const qaItems = cleanList([
    ...requestSignals.pilot,
    ...(data.qaReport?.testCases ?? []),
    ...(data.qaReport?.regressionChecks ?? []),
    ...(data.qaReport?.qualityRisks ?? []),
  ]);

  const revenueItems = filterBusinessItems(
    cleanList([...requestSignals.revenue, ...plannerItems, ...developerItems, ...reviewerItems]),
    ['수익', '가격', '구독', '과금', '프로레타', 'pro-rata', 'pro rata', '매출', '비용', 'cac'],
  );
  const customerItems = filterBusinessItems(
    cleanList([...requestSignals.customer, ...plannerItems, ...architectItems, ...reviewerItems, ...qaItems]),
    ['고객', 'b2b', '영업', '확보', '채널', '파일럿', '광고', 'cac', '시장', '파트너'],
  );
  const riskItems = cleanList([
    ...requestSignals.risk,
    ...(data.plannerReport?.risks ?? []),
    ...(data.reviewerReport?.risks ?? []),
    ...(data.qaReport?.qualityRisks ?? []),
  ]);

  return {
    coreIdea: sanitizeBusinessBlock(
      buildStructuredBlock(
        data.plannerReport?.summary ?? data.plannerSummary,
        '핵심 아이디어 요약이 없습니다.',
        [data.plannerReport?.steps ?? []],
      ),
      '핵심 아이디어 요약이 없습니다.',
    ),
    revenueModel: sanitizeBusinessBlock({
      text: revenueItems[0] ?? '수익모델은 구독료, 성과 기반 또는 프로레타 구조를 파일럿에서 비교 검토합니다.',
      bullets: revenueItems.slice(1, 7),
    }, '수익모델 검토 항목이 없습니다.'),
    customerAcquisition: sanitizeBusinessBlock({
      text: customerItems[0] ?? '초기 고객 확보는 B2B 파일럿과 명확한 성과 지표 중심으로 검증합니다.',
      bullets: customerItems.slice(1, 7),
    }, '고객 확보 전략 항목이 없습니다.'),
    risks: sanitizeBusinessBlock({
      text: riskItems[0] ?? reviewerItems[0] ?? '주요 리스크는 고객 검증, 비용 구조, 운영 책임 범위를 중심으로 관리합니다.',
      bullets: [...riskItems.slice(1), ...reviewerItems.slice(0, 4)],
    }, '주요 리스크 항목이 없습니다.'),
    operationsAutomation: sanitizeBusinessBlock(
      buildStructuredBlock(
        data.developerReport?.summary ?? data.developerSummary,
        '운영/자동화 가능 영역 요약이 없습니다.',
        [
          data.developerReport?.implementationPlan ?? [],
          data.developerReport?.filesToChange ?? [],
          data.developerReport?.testPlan ?? [],
        ],
      ),
      '운영/자동화 가능 영역 요약이 없습니다.',
    ),
    pilotChecklist: sanitizeBusinessBlock(
      buildStructuredBlock(
        data.qaReport?.summary ?? data.qaSummary,
        '파일럿 검증 체크리스트가 없습니다.',
        [
          data.qaReport?.testCases ?? [],
          data.qaReport?.regressionChecks ?? [],
          data.qaReport?.qualityRisks ?? [],
        ],
      ),
      '파일럿 검증 체크리스트가 없습니다.',
    ),
  };
}

function buildReport(data: FullFlowSummaryData): FinalReport | null {
  if (data.status !== 'completed') return null;
  const mode = data.analysisMode ?? 'business';

  const planner = buildStructuredBlock(
    data.plannerReport?.summary ?? data.plannerSummary,
    'Planner 분석 요약이 없습니다.',
    [data.plannerReport?.steps ?? [], data.plannerReport?.risks ?? []],
  );
  const architect = buildStructuredBlock(
    data.architectReport?.summary ?? data.architectSummary,
    'Architect 구조/운영 검토 요약이 없습니다.',
    [
      data.architectReport?.architectureNotes ?? [],
      data.architectReport?.dataFlow ?? [],
      data.architectReport?.risks ?? [],
    ],
  );
  const developer = buildStructuredBlock(
    data.developerReport?.summary ?? data.developerSummary,
    'Developer 실행/구현 계획 요약이 없습니다.',
    [
      data.developerReport?.implementationPlan ?? [],
      data.developerReport?.filesToChange ?? [],
      data.developerReport?.testPlan ?? [],
      data.developerReport?.risks ?? [],
    ],
  );
  const reviewer = buildStructuredBlock(
    data.reviewerReport?.summary ?? data.reviewerSummary,
    'Reviewer 검토 의견이 없습니다.',
    [
      data.reviewerReport?.reviewFindings ?? [],
      data.reviewerReport?.suggestedChanges ?? [],
      data.reviewerReport?.risks ?? [],
    ],
  );
  const qa = buildStructuredBlock(
    data.qaReport?.summary ?? data.qaSummary,
    'QA 검증 결과가 없습니다.',
    [
      data.qaReport?.testCases ?? [],
      data.qaReport?.regressionChecks ?? [],
      data.qaReport?.qualityRisks ?? [],
    ],
  );
  const finalRecommendation = buildFinalRecommendation(data);
  const totalTokens = data.totalInputTokens + data.totalOutputTokens;

  return {
    mode,
    title: buildTitle(data),
    originalRequest: data.originalRequest?.trim() || '기존 최우선 태스크 기반 Full Flow 실행',
    attachments: data.attachments ?? [],
    executiveSummary: buildExecutiveSummary(data, planner, architect, developer, finalRecommendation),
    planner,
    architect,
    developer,
    reviewer: {
      text: reviewer.text,
      bullets: [...reviewer.bullets, `Reviewer 승인 상태: ${formatApprovalStatus(data.reviewerApprovalStatus)}`],
    },
    qa: {
      text: qa.text,
      bullets: [...qa.bullets, `QA 최종 상태: ${formatQaStatus(data.qaFinalStatus)}`],
    },
    businessSections: mode === 'business' ? buildBusinessSections(data) : undefined,
    finalRecommendation,
    nextActions: buildNextActions(data),
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

function markdownAttachments(attachments: WorkRequestAttachment[]): string[] {
  if (attachments.length === 0) return ['첨부파일 없음'];

  return attachments.flatMap(attachment => [
    `- ${attachment.name} (${attachment.extension || 'unknown'}, ${formatBytes(attachment.size)}, ${attachment.usedInContext ? '본문 반영' : '파일명만 반영'})`,
    attachment.preview ? `  - preview: ${attachment.preview.slice(0, 220).replace(/\n/g, ' ')}` : '',
  ]).filter(Boolean);
}

function buildMarkdown(report: FinalReport): string {
  if (report.mode === 'business' && report.businessSections) {
    return [
      `# ${report.title}`,
      '',
      '## 요청 내용',
      report.originalRequest,
      '',
      '## Attachments',
      ...markdownAttachments(report.attachments),
      '',
      '## Executive Summary',
      ...markdownBlock(sanitizeBusinessBlock(report.executiveSummary, 'Executive Summary가 없습니다.')),
      '',
      '## 핵심 아이디어',
      ...markdownBlock(report.businessSections.coreIdea),
      '',
      '## 수익모델/운영모델 검토',
      ...markdownBlock(report.businessSections.revenueModel),
      '',
      '## 고객 확보 전략',
      ...markdownBlock(report.businessSections.customerAcquisition),
      '',
      '## 주요 리스크',
      ...markdownBlock(report.businessSections.risks),
      '',
      '## 운영/자동화 가능 영역',
      ...markdownBlock(report.businessSections.operationsAutomation),
      '',
      '## 파일럿 검증 체크리스트',
      ...markdownBlock(report.businessSections.pilotChecklist),
      '',
      '## 최종 권장사항',
      report.finalRecommendation,
      '',
      '## 다음 액션',
      ...report.nextActions.map((action, index) => `${index + 1}. ${sanitizeBusinessText(action)}`),
    ].join('\n');
  }

  return [
    `# ${report.title}`,
    '',
    '## Original Request',
    report.originalRequest,
    '',
    '## Attachments',
    ...markdownAttachments(report.attachments),
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
    `- total input tokens: ${report.totalInputTokens}`,
    `- total output tokens: ${report.totalOutputTokens}`,
    `- total tokens: ${report.totalTokens}`,
    `- total latency: ${report.totalLatencyMs}ms`,
    `- completed at: ${report.completedAt ? `${formatKstTime(report.completedAt)} KST` : 'unknown'}`,
    report.mockFallbackAgents.length > 0 ? `- mock fallback agents: ${report.mockFallbackAgents.join(', ')}` : '- mock fallback agents: none',
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

function ReportAttachmentSection({ attachments }: { attachments: WorkRequestAttachment[] }) {
  if (attachments.length === 0) return null;

  return (
    <div className="final-report-section final-report-attachments">
      <span>Attachments</span>
      <ul>
        {attachments.map(attachment => (
          <li key={attachment.id}>
            <strong>{attachment.name}</strong>
            {' '}
            <em>{attachment.extension || 'unknown'} · {formatBytes(attachment.size)} · {attachment.usedInContext ? '본문 반영' : '파일명만 반영'}</em>
            {attachment.preview && <p>{attachment.preview.slice(0, 240)}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function FinalReportPanel() {
  const [collapsed, setCollapsed] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const [notifyStatus, setNotifyStatus] = useState<NotifyStatusResponse | null>(null);
  const [notifyBusy, setNotifyBusy] = useState<NotifyChannel | null>(null);
  const [notifyMessage, setNotifyMessage] = useState<string | null>(null);
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

  useEffect(() => {
    let active = true;

    fetch('/api/notify')
      .then(response => response.json())
      .then((result: NotifyStatusResponse) => {
        if (active) setNotifyStatus(result);
      })
      .catch(() => {
        if (active) setNotifyStatus(null);
      });

    return () => {
      active = false;
    };
  }, []);

  function logSecretary(message: string) {
    const store = useSimStore.getState();
    const secretary = store.agents.secretary;
    store.addEvent({
      agentId: 'secretary',
      agentName: secretary.name,
      agentColor: secretary.primaryColor,
      type: 'system',
      message,
    });
  }

  function notifyButtonLabel(channel: NotifyChannel): string {
    const state = notifyStatus?.channels[channel];
    if (!state) return channel === 'slack' ? 'Slack status...' : 'Telegram status...';
    if (state.status === 'ready') return channel === 'slack' ? 'Send to Slack' : 'Send to Telegram';
    if (state.status === 'disabled') return `${channel === 'slack' ? 'Slack' : 'Telegram'} disabled`;
    return `${channel === 'slack' ? 'Slack' : 'Telegram'} not configured`;
  }

  function isNotifyDisabled(channel: NotifyChannel): boolean {
    return !displayReport || notifyBusy !== null || notifyStatus?.channels[channel]?.status !== 'ready';
  }

  async function sendNotification(channel: NotifyChannel) {
    if (!displayReport || isNotifyDisabled(channel)) return;

    const label = channel === 'slack' ? 'Slack' : 'Telegram';
    setNotifyBusy(channel);
    setNotifyMessage(null);
    logSecretary(`[Secretary] ${label} 알림 전송 준비`);
    useSimStore.getState().setStatus('secretary', 'thinking');
    useSimStore.getState().setSpeech('secretary', `${label} 알림 준비 중...`);

    try {
      const response = await fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel,
          title: displayReport.title,
          summary: displayReport.executiveSummary.text,
          reportMarkdown: displayMarkdown,
          nextActions: displayReport.nextActions,
        }),
      });
      const result = await response.json() as { ok?: boolean; message?: string };
      if (!result.ok) {
        const message = result.message ?? `${label} 전송 실패`;
        setNotifyMessage(message);
        logSecretary(`[Secretary] 전송 실패: ${message}`);
        useSimStore.getState().setSpeech('secretary', `전송 실패: ${message}`.slice(0, 72));
        return;
      }

      setNotifyMessage(result.message ?? `${label} notification sent.`);
      logSecretary(`[Secretary] ${label} 전송 완료`);
      useSimStore.getState().setSpeech('secretary', `${label} 전송 완료`);
      useSimStore.getState().bumpCompleted('secretary');
    } catch {
      setNotifyMessage(`${label} network error.`);
      logSecretary('[Secretary] 전송 실패: network_error');
      useSimStore.getState().setSpeech('secretary', '전송 실패: network_error');
    } finally {
      setNotifyBusy(null);
      useSimStore.getState().setStatus('secretary', 'idle');
      useSimStore.getState().setTask('secretary', null);
    }
  }

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
            onClick={() => { void sendNotification('slack'); }}
            disabled={isNotifyDisabled('slack')}
            title={notifyStatus?.channels.slack.status ?? 'checking'}
          >
            {notifyBusy === 'slack' ? 'Sending...' : notifyButtonLabel('slack')}
          </button>
          <button
            className="trace-refresh-btn"
            type="button"
            onClick={() => { void sendNotification('telegram'); }}
            disabled={isNotifyDisabled('telegram')}
            title={notifyStatus?.channels.telegram.status ?? 'checking'}
          >
            {notifyBusy === 'telegram' ? 'Sending...' : notifyButtonLabel('telegram')}
          </button>
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
                <span>{displayReport.mode === 'business' ? '요청 내용' : 'Original Request'}</span>
                <p>{displayReport.originalRequest}</p>
              </div>

              <ReportAttachmentSection attachments={displayReport.attachments} />

              {(notifyMessage || displayReport) && (
                <div className="final-report-integrations">
                  <span>Secretary / Integrations</span>
                  <div>
                    <button type="button" disabled>Save to Google Drive · Coming soon</button>
                    <button type="button" disabled>Send via Gmail · Coming soon</button>
                    <button type="button" disabled>Export to Google Sheets · Coming soon</button>
                  </div>
                  {notifyMessage && <p>{notifyMessage}</p>}
                </div>
              )}

              {displayReport.mode === 'business' && displayReport.businessSections ? (
                <>
                  <ReportSection
                    title="Executive Summary"
                    block={sanitizeBusinessBlock(displayReport.executiveSummary, 'Executive Summary가 없습니다.')}
                  />
                  <ReportSection title="핵심 아이디어" block={displayReport.businessSections.coreIdea} />
                  <ReportSection title="수익모델/운영모델 검토" block={displayReport.businessSections.revenueModel} />
                  <ReportSection title="고객 확보 전략" block={displayReport.businessSections.customerAcquisition} />
                  <ReportSection title="주요 리스크" block={displayReport.businessSections.risks} />
                  <ReportSection title="운영/자동화 가능 영역" block={displayReport.businessSections.operationsAutomation} />
                  <ReportSection title="파일럿 검증 체크리스트" block={displayReport.businessSections.pilotChecklist} />
                </>
              ) : (
                <>
                  <ReportSection title="Executive Summary" block={displayReport.executiveSummary} />
                  <ReportSection title="Planner 분석 요약" block={displayReport.planner} />
                  <ReportSection title="Architect 구조/운영 검토 요약" block={displayReport.architect} />
                  <ReportSection title="Developer 실행/구현 계획 요약" block={displayReport.developer} />
                  <ReportSection title="Reviewer 검토 의견" block={displayReport.reviewer} />
                  <ReportSection title="QA 검증 결과" block={displayReport.qa} />
                </>
              )}

              <div className="final-report-recommendation">
                <span>{displayReport.mode === 'business' ? '최종 권장사항' : 'Final Recommendation'}</span>
                <strong>{displayReport.finalRecommendation}</strong>
              </div>

              {displayReport.mode === 'software' && displayReport.mockFallbackAgents.length > 0 && (
                <div className="final-report-warning">
                  <span>Mock fallback</span>
                  <strong>{displayReport.mockFallbackAgents.join(' / ')}</strong>
                </div>
              )}

              <div className="final-report-actions">
                <span>{displayReport.mode === 'business' ? '다음 액션' : 'Next Actions'}</span>
                <ol>
                  {displayReport.nextActions.map(action => (
                    <li key={action}>{displayReport.mode === 'business' ? sanitizeBusinessText(action) : action}</li>
                  ))}
                </ol>
              </div>

              {displayReport.mode === 'software' && (
                <div className="final-report-ops">
                  <span>tokens {displayReport.totalTokens}</span>
                  <span>input {displayReport.totalInputTokens}</span>
                  <span>output {displayReport.totalOutputTokens}</span>
                  <span>latency {displayReport.totalLatencyMs}ms</span>
                  {displayReport.completedAt && <span>{formatKstTime(displayReport.completedAt)} KST</span>}
                </div>
              )}
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
