export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const error = searchParams.get('error');

  if (error) {
    return Response.json({ ok: false, status: 'oauth_error', message: error }, { status: 400 });
  }

  if (!code) {
    return Response.json({ ok: false, status: 'missing_code', message: 'Google OAuth callback did not include a code.' }, { status: 400 });
  }

  return Response.json({
    ok: true,
    status: 'callback_received',
    message: 'OAuth callback received. Token exchange and secure token storage are TODO for the next integration step.',
  });
}
