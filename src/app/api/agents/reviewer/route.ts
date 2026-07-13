import { createAgentPostHandler } from '@/lib/llm/agentRoute';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';
export const POST = createAgentPostHandler({
  role: 'reviewer',
  shape: '{"summary":"string","reviewFindings":["string"],"suggestedChanges":["string"],"risks":["string"],"approvalStatus":"approved","nextAgent":"qa"}',
  prompt: 'Review for bugs, security, performance, maintainability, missing tests, suggested changes, approval, and next agent.',
  fallback: { summary: 'Mock code review completed.', reviewFindings: ['Check error handling and state transitions.'], suggestedChanges: ['Keep provider failures non-fatal.'], risks: ['Regression in existing simulation.'], approvalStatus: 'needs_more_info', nextAgent: 'qa' },
  arrayFields: ['reviewFindings', 'suggestedChanges', 'risks'], enumFields: { approvalStatus: ['approved', 'changes_requested', 'needs_more_info'], nextAgent: ['developer', 'qa'] },
});
