import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { googleOAuthEnabled } from '../src/lib/googleOAuth.js';
import {
  signGoogleOAuthState,
  verifyGoogleOAuthState,
  signGoogleSignupToken,
  verifyGoogleSignupToken,
  verifyChallengeToken,
  signChallengeToken,
} from '../src/auth/jwt.js';

beforeAll(async () => {
  await seedIfEmpty();
});

describe('Google OAuth — honestly disabled without real credentials in tests', () => {
  it('is disabled without GOOGLE_OAUTH_CLIENT_ID/SECRET', () => {
    expect(googleOAuthEnabled).toBe(false);
  });

  it('GET /auth/google/config reports disabled — client hides the button', async () => {
    const res = await request(app).get('/api/auth/google/config');
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
  });

  it('GET /auth/google/start 404s rather than pretending to redirect anywhere real', async () => {
    const res = await request(app).get('/api/auth/google/start');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_configured');
  });

  it('GET /auth/google/callback redirects to the app with an error when disabled', async () => {
    const res = await request(app).get('/api/auth/google/callback?code=x&state=y');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('googleError=nao_configurado');
  });
});

describe('Google OAuth state/signup tokens — the stateless CSRF + pending-signup mechanism', () => {
  it('signs and verifies a state token, round-tripping the referral code', () => {
    const token = signGoogleOAuthState('REF123');
    const decoded = verifyGoogleOAuthState(token);
    expect(decoded).toEqual({ referralCode: 'REF123' });
  });

  it('rejects a garbage token, and a real-but-differently-typed JWT, as OAuth state', () => {
    expect(verifyGoogleOAuthState('not-a-real-jwt')).toBeNull();
    // A 2FA challenge token is a real, validly-signed JWT — but the wrong `typ`, so it
    // must never be accepted as OAuth state (same cross-token-type rejection principle
    // documented in auth/jwt.ts for the access-token/challenge-token boundary).
    const challengeToken = signChallengeToken(1);
    expect(verifyGoogleOAuthState(challengeToken)).toBeNull();
  });

  it('signs and verifies a pending-signup token carrying the Google-verified identity', () => {
    const token = signGoogleSignupToken({ email: 'nova@empresa.com.br', nome: 'Nova Pessoa', googleSub: 'g-123', referralCode: null });
    const decoded = verifyGoogleSignupToken(token);
    expect(decoded).toEqual({ email: 'nova@empresa.com.br', nome: 'Nova Pessoa', googleSub: 'g-123', referralCode: null });
  });

  it('a signup token is never accepted as a real 2FA challenge token or vice versa', () => {
    const signupToken = signGoogleSignupToken({ email: 'x@y.com', nome: 'X', googleSub: 'g-1' });
    expect(verifyChallengeToken(signupToken)).toBeNull();
  });
});

describe('POST /auth/google/complete-signup', () => {
  it('rejects an invalid/expired signup token', async () => {
    const res = await request(app)
      .post('/api/auth/google/complete-signup')
      .send({ signupToken: 'garbage-not-a-real-jwt-token', companyName: 'Empresa X', role: 'cedente' });
    expect(res.status).toBe(401);
  });

  it('rejects when the email was claimed in the meantime', async () => {
    const signupToken = signGoogleSignupToken({ email: 'cedente@lastro.demo', nome: 'Alguém', googleSub: 'g-clash-1' });
    const res = await request(app)
      .post('/api/auth/google/complete-signup')
      .send({ signupToken, companyName: 'Empresa X', role: 'cedente' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('email_taken');
  });

  it('requires an insurerKey for the seguradora role', async () => {
    const signupToken = signGoogleSignupToken({ email: `nova-${Date.now()}@example.com`, nome: 'Nova', googleSub: `g-${Date.now()}` });
    const res = await request(app)
      .post('/api/auth/google/complete-signup')
      .send({ signupToken, companyName: 'Seguradora Nova', role: 'seguradora' });
    expect(res.status).toBe(400);
  });

  it('creates a real, login-capable account from a valid signup token', async () => {
    const email = `nova-google-${Date.now()}@example.com`;
    const signupToken = signGoogleSignupToken({ email, nome: 'Pessoa Google', googleSub: `g-${Date.now()}-unique` });
    const res = await request(app)
      .post('/api/auth/google/complete-signup')
      .send({ signupToken, companyName: 'Empresa via Google Ltda', role: 'cedente' });
    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.email).toBe(email);
    expect(res.body.user.companyName).toBe('Empresa via Google Ltda');

    // The token proves account creation actually worked — a real, usable session.
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${res.body.token}`);
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(email);
  });

  it('the same signup token cannot be replayed to create a second account', async () => {
    const email = `replay-${Date.now()}@example.com`;
    const signupToken = signGoogleSignupToken({ email, nome: 'Replay', googleSub: `g-replay-${Date.now()}` });
    const first = await request(app)
      .post('/api/auth/google/complete-signup')
      .send({ signupToken, companyName: 'Primeira Ltda', role: 'cedente' });
    expect(first.status).toBe(201);
    const second = await request(app)
      .post('/api/auth/google/complete-signup')
      .send({ signupToken, companyName: 'Segunda Ltda', role: 'investidor' });
    expect(second.status).toBe(409);
  });
});
