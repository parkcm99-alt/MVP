import { createAgentPostHandler } from '@/lib/llm/agentRoute';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';
export const POST = createAgentPostHandler({
  role: 'qa',
  shape: '{"summary":"string","testCases":["string"],"regressionChecks":["string"],"qualityRisks":["string"],"finalStatus":"passed","nextAgent":"planner"}',
  prompt: 'Create test cases, regression checklist, quality risks, final verification status, and a recovery handoff.',
  fallback: { summary: 'Mock QA plan completed.', testCases: ['Verify happy path and safe fallback.'], regressionChecks: ['Realtime, task queue, event log, debug panel.'], qualityRisks: ['Environment-specific configuration.'], finalStatus: 'needs_more_testing', nextAgent: 'planner' },
  arrayFields: ['testCases', 'regressionChecks', 'qualityRisks'], enumFields: { finalStatus: ['passed', 'failed', 'needs_more_testing'], nextAgent: ['developer', 'reviewer', 'planner'] },
});
