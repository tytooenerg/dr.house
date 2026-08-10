import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import type { Role } from '../db/types.js';
import { logger } from '../lib/logger.js';

const SECRET = process.env.JWT_SECRET || 'lastro-dev-secret-change-in-production';
if (!process.env.JWT_SECRET) {
  logger.warn('[auth] JWT_SECRET not set — using an insecure development default. Set JWT_SECRET in production.');
}

export interface TokenPayload {
  sub: number;
  role: Role;
}

// Short-lived — the client silently exchanges this for a new pair via /auth/refresh
// using the long-lived refresh token, so a stolen access token has a small blast radius.
export function signAccessToken(payload: TokenPayload): string {
  return jwt.sign(payload, SECRET, { expiresIn: '15m' });
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    const decoded = jwt.verify(token, SECRET) as Record<string, unknown>;
    // A 2FA challenge token (see below) is signed with the same secret but carries `typ`
    // and no `role` — reject it here so it can never be used as a real access token
    // (i.e. so knowing only the password, without the TOTP code, is never enough).
    if (decoded.typ) return null;
    return decoded as unknown as TokenPayload;
  } catch {
    return null;
  }
}

const CHALLENGE_TYPE = '2fa_challenge';

// Issued right after a correct email+password when the account has 2FA enabled — proves
// "this request already passed step 1" without granting any actual API access. Exchanged
// for real tokens by POST /auth/2fa/verify-login once the TOTP/recovery code checks out.
export function signChallengeToken(userId: number): string {
  return jwt.sign({ sub: userId, typ: CHALLENGE_TYPE }, SECRET, { expiresIn: '5m' });
}

export function verifyChallengeToken(token: string): number | null {
  try {
    const decoded = jwt.verify(token, SECRET) as Record<string, unknown>;
    if (decoded.typ !== CHALLENGE_TYPE || typeof decoded.sub !== 'number') return null;
    return decoded.sub;
  } catch {
    return null;
  }
}

const GOOGLE_OAUTH_STATE_TYPE = 'google_oauth_state';

// CSRF protection for the Google OAuth redirect round-trip — stateless (no server-side
// session store needed) since the state itself is a signed, short-lived JWT the callback
// verifies came from us, carrying only a nonce and an optional referral code to preserve
// across the redirect to Google and back.
export function signGoogleOAuthState(referralCode?: string): string {
  return jwt.sign({ typ: GOOGLE_OAUTH_STATE_TYPE, nonce: crypto.randomBytes(8).toString('hex'), ref: referralCode ?? null }, SECRET, { expiresIn: '10m' });
}

export function verifyGoogleOAuthState(token: string): { referralCode: string | null } | null {
  try {
    const decoded = jwt.verify(token, SECRET) as Record<string, unknown>;
    if (decoded.typ !== GOOGLE_OAUTH_STATE_TYPE) return null;
    return { referralCode: typeof decoded.ref === 'string' ? decoded.ref : null };
  } catch {
    return null;
  }
}

const GOOGLE_SIGNUP_TYPE = 'google_signup';

// Issued after a real Google OAuth exchange for an email Lastro has never seen — proves
// "Google already verified this person owns this email" without creating an account yet,
// since role/companyName still need to be collected (see completar-cadastro-google on the
// client). Exchanged for a real account by POST /auth/google/complete-signup.
export function signGoogleSignupToken(input: { email: string; nome: string; googleSub: string; referralCode?: string | null }): string {
  return jwt.sign({ typ: GOOGLE_SIGNUP_TYPE, email: input.email, nome: input.nome, googleSub: input.googleSub, ref: input.referralCode ?? null }, SECRET, {
    expiresIn: '30m',
  });
}

export interface GoogleSignupTokenPayload {
  email: string;
  nome: string;
  googleSub: string;
  referralCode: string | null;
}

export function verifyGoogleSignupToken(token: string): GoogleSignupTokenPayload | null {
  try {
    const decoded = jwt.verify(token, SECRET) as Record<string, unknown>;
    if (decoded.typ !== GOOGLE_SIGNUP_TYPE || typeof decoded.email !== 'string' || typeof decoded.googleSub !== 'string') return null;
    return { email: decoded.email, nome: typeof decoded.nome === 'string' ? decoded.nome : '', googleSub: decoded.googleSub, referralCode: typeof decoded.ref === 'string' ? decoded.ref : null };
  } catch {
    return null;
  }
}

// RelayState for the SAML SP-initiated redirect round-trip — same reasoning as
// signGoogleOAuthState (stateless CSRF protection, carries only a nonce + optional
// referral code across the redirect to the IdP and back).
const SAML_RELAY_STATE_TYPE = 'saml_relay_state';

export function signSamlRelayState(referralCode?: string): string {
  return jwt.sign({ typ: SAML_RELAY_STATE_TYPE, nonce: crypto.randomBytes(8).toString('hex'), ref: referralCode ?? null }, SECRET, { expiresIn: '10m' });
}

export function verifySamlRelayState(token: string): { referralCode: string | null } | null {
  try {
    const decoded = jwt.verify(token, SECRET) as Record<string, unknown>;
    if (decoded.typ !== SAML_RELAY_STATE_TYPE) return null;
    return { referralCode: typeof decoded.ref === 'string' ? decoded.ref : null };
  } catch {
    return null;
  }
}

const SAML_SIGNUP_TYPE = 'saml_signup';

// Issued after a real, signature-verified SAML assertion for an email Lastro has never
// seen — proves "the configured IdP already authenticated this person as this email"
// without creating an account yet, since role/companyName still need to be collected.
// Exchanged for a real account by POST /auth/saml/complete-signup.
export function signSamlSignupToken(input: { email: string; nome: string; samlSubjectId: string; referralCode?: string | null }): string {
  return jwt.sign({ typ: SAML_SIGNUP_TYPE, email: input.email, nome: input.nome, samlSubjectId: input.samlSubjectId, ref: input.referralCode ?? null }, SECRET, {
    expiresIn: '30m',
  });
}

export interface SamlSignupTokenPayload {
  email: string;
  nome: string;
  samlSubjectId: string;
  referralCode: string | null;
}

export function verifySamlSignupToken(token: string): SamlSignupTokenPayload | null {
  try {
    const decoded = jwt.verify(token, SECRET) as Record<string, unknown>;
    if (decoded.typ !== SAML_SIGNUP_TYPE || typeof decoded.email !== 'string' || typeof decoded.samlSubjectId !== 'string') return null;
    return {
      email: decoded.email,
      nome: typeof decoded.nome === 'string' ? decoded.nome : '',
      samlSubjectId: decoded.samlSubjectId,
      referralCode: typeof decoded.ref === 'string' ? decoded.ref : null,
    };
  } catch {
    return null;
  }
}

export function generateRefreshToken(): string {
  return crypto.randomBytes(48).toString('hex');
}

export function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
