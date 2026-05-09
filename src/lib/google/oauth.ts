import 'server-only';

import type { GoogleIntegrationStatus, GoogleOAuthConfig } from './types';

const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/spreadsheets.readonly',
];

export function getGoogleOAuthConfig(): GoogleOAuthConfig {
  const enabled = process.env.GOOGLE_OAUTH_ENABLED === 'true';
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim() || null;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() || null;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI?.trim() || null;

  return {
    enabled,
    configured: Boolean(clientId && clientSecret && redirectUri),
    clientId,
    redirectUri,
  };
}

export function getGoogleIntegrationStatus(): GoogleIntegrationStatus {
  const config = getGoogleOAuthConfig();
  const oauth = !config.enabled
    ? 'disabled'
    : config.configured
      ? 'connected'
      : 'not_configured';
  const serviceStatus = oauth === 'connected' ? 'mock' : oauth;

  return {
    ok: true,
    oauth,
    services: {
      drive: serviceStatus,
      gmail: serviceStatus,
      sheets: serviceStatus,
    },
  };
}

export function buildGoogleAuthUrl(state?: string): string | null {
  const config = getGoogleOAuthConfig();
  if (!config.enabled || !config.configured || !config.clientId || !config.redirectUri) return null;

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    scope: GOOGLE_SCOPES.join(' '),
  });

  if (state) params.set('state', state);
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}
