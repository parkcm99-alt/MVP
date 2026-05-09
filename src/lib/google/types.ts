export type GoogleServiceName = 'drive' | 'gmail' | 'sheets';
export type GoogleServiceStatus = 'ready' | 'mock' | 'disabled' | 'not_configured';

export interface GoogleOAuthConfig {
  enabled: boolean;
  configured: boolean;
  clientId: string | null;
  redirectUri: string | null;
}

export interface GoogleIntegrationStatus {
  ok: true;
  oauth: 'disabled' | 'not_configured' | 'connected';
  services: Record<GoogleServiceName, GoogleServiceStatus>;
}

export interface GoogleMockResult<T = unknown> {
  ok: boolean;
  mode: 'mock' | 'todo';
  message: string;
  data?: T;
}
