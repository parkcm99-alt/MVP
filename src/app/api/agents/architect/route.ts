import { createAgentPostHandler } from '@/lib/llm/agentRoute';
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic';
export const POST = createAgentPostHandler({
  role: 'architect',
  shape: '{"summary":"string","architectureNotes":["string"],"dataFlow":["string"],"risks":["string"],"nextAgent":"developer"}',
  prompt: 'Review system structure, data flow, API/DB boundaries, implementation risks, and recommend the next agent.',
  fallback: { summary: 'Mock architecture review completed.', architectureNotes: ['Keep UI, API routes, and persistence boundaries explicit.'], dataFlow: ['UI → server route → provider/Supabase'], risks: ['Validate failure-safe fallbacks.'], nextAgent: 'developer' },
  arrayFields: ['architectureNotes', 'dataFlow', 'risks'], enumFields: { nextAgent: ['developer', 'reviewer', 'qa'] },
});
