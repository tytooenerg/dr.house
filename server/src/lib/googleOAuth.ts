import { logger } from './logger.js';

// Real "Entrar com Google" — a real OAuth 2.0 authorization-code flow against Google's
// actual endpoints (not a consumer-style enterprise SSO/SAML replacement — see README
// "Known gaps" for why full SAML genuinely can't be built here). Unlike every other
// real-when-configured integration in this codebase, there is deliberately no simulated
// fallback: faking a third party's identity verification would be dishonest in a way
// simulating a payment or a registry number isn't, so the "Continuar com Google" button
// is simply hidden on the client when this isn't configured (GET /auth/google/config).

const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;

export const googleOAuthEnabled = !!(clientId && clientSecret);

if (googleOAuthEnabled) logger.info('[google-oauth] GOOGLE_OAUTH_CLIENT_ID/SECRET configurado — "Entrar com Google" habilitado');
else logger.info('[google-oauth] GOOGLE_OAUTH_CLIENT_ID/SECRET não configurado — "Entrar com Google" ficará oculto no cliente');

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

export function buildGoogleAuthUrl(state: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: clientId!,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export interface GoogleProfile {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
}

export async function exchangeCodeForProfile(code: string, redirectUri: string): Promise<GoogleProfile> {
  const tokenRes = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId!,
      client_secret: clientSecret!,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!tokenRes.ok) throw new Error(`google_oauth_token_failed: ${tokenRes.status} ${await tokenRes.text()}`);
  const tokenData = (await tokenRes.json()) as { access_token: string };

  const profileRes = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${tokenData.access_token}` } });
  if (!profileRes.ok) throw new Error(`google_oauth_userinfo_failed: ${profileRes.status} ${await profileRes.text()}`);
  const profile = (await profileRes.json()) as { sub: string; email: string; email_verified?: boolean; name?: string };
  return { sub: profile.sub, email: profile.email, emailVerified: !!profile.email_verified, name: profile.name || profile.email };
}
