import { handleSpecialistAgent } from '@/lib/llm/agentRoute';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function POST(request: Request) {
  return handleSpecialistAgent(request, 'developer');
}
