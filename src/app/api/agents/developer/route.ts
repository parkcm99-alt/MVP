import { handleSpecialistPost } from '@/lib/llm/agentRoute';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  return handleSpecialistPost(request, 'developer');
}
