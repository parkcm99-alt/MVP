export type RequestAnalysisMode = 'business' | 'software';

const BUSINESS_KEYWORDS = [
  '사업',
  '비즈니스',
  '영업',
  '제안서',
  '미팅',
  '보고서',
  '기획',
  '운영',
  '리스크 검토',
  '고객',
  '수익',
  '가격',
  '구독',
  '파일럿',
  '시장',
  '마케팅',
  '거래처',
  '정산',
];

const INTERNAL_SOFTWARE_KEYWORDS = [
  '코드',
  'code',
  'bug',
  'fix',
  'implementation',
  'software',
  'db',
  'database',
  'schema',
  '스키마',
  'react',
  'next.js',
  'nextjs',
  'supabase',
  'component',
  '컴포넌트',
  'route',
  '라우트',
  'src/',
  'src\\',
  'npm run',
  'lint',
  'build',
  '버그 수정',
  '프론트엔드',
  '백엔드',
  '서버',
  '클라이언트',
  '마이그레이션',
  'migration',
];

const IMPLEMENTATION_KEYWORDS = [
  'api',
  '개발',
  '구현',
  '앱 개발',
  '기능 추가',
  '기능 수정',
];

export function classifyWorkRequest(text: string): RequestAnalysisMode {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return 'business';

  const hasBusinessIntent = BUSINESS_KEYWORDS.some(keyword => normalized.includes(keyword.toLowerCase()));
  const hasInternalSoftwareIntent = INTERNAL_SOFTWARE_KEYWORDS.some(keyword => normalized.includes(keyword.toLowerCase()));

  if (hasInternalSoftwareIntent) return 'software';
  if (hasBusinessIntent) return 'business';

  const hasImplementationIntent = IMPLEMENTATION_KEYWORDS.some(keyword => normalized.includes(keyword.toLowerCase()));
  if (hasImplementationIntent) return 'software';

  return 'business';
}

export function normalizeRequestAnalysisMode(
  value: unknown,
  title = '',
  description = '',
): RequestAnalysisMode {
  if (value === 'business' || value === 'software') return value;
  return classifyWorkRequest(`${title}\n${description}`);
}

export function describeRequestAnalysisMode(mode: RequestAnalysisMode): string {
  return mode === 'software' ? 'Software Implementation Mode' : 'Business Planning Mode';
}
