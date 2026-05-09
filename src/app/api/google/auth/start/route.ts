import { buildGoogleAuthUrl, getGoogleOAuthConfig } from '@/lib/google/oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const config = getGoogleOAuthConfig();
  if (!config.enabled) {
    return Response.json({ ok: false, status: 'disabled', message: 'Google OAuth is disabled.' }, { status: 202 });
  }
  if (!config.configured) {
    return Response.json({ ok: false, status: 'not_configured', message: 'Google OAuth is not configured.' }, { status: 202 });
  }

  const { searchParams } = new URL(request.url);
  const authUrl = buildGoogleAuthUrl(searchParams.get('state') ?? undefined);
  if (!authUrl) {
    return Response.json({ ok: false, status: 'not_configured', message: 'Google OAuth URL could not be built.' }, { status: 202 });
  }

  return Response.redirect(authUrl);
}
