import { createAgentPostHandler } from '@/lib/llm/agentRoute';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';
export const POST = createAgentPostHandler({
  role: 'developer',
  shape: '{"summary":"string","implementationPlan":["string"],"filesToChange":["string"],"testPlan":["string"],"risks":["string"],"nextAgent":"reviewer"}',
  prompt: 'Produce an implementation plan, likely files, API/state/component changes, test plan, risks, and next agent.',
  fallback: { summary: 'Mock implementation plan completed.', implementationPlan: ['Implement a small isolated change.'], filesToChange: ['Relevant route and UI component'], testPlan: ['Run lint and build.'], risks: ['Avoid breaking existing realtime flow.'], nextAgent: 'reviewer' },
  arrayFields: ['implementationPlan', 'filesToChange', 'testPlan', 'risks'], enumFields: { nextAgent: ['reviewer', 'qa'] },
});
