import { handleStructuredAgentRequest } from '@/lib/llm/structuredAgentRoute';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  return handleStructuredAgentRequest(request, 'reviewer');
}
