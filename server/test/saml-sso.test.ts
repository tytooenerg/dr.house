import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { samlSsoEnabled } from '../src/lib/samlSso.js';
import {
  signSamlRelayState,
  verifySamlRelayState,
  signSamlSignupToken,
  verifySamlSignupToken,
  verifyChallengeToken,
  signChallengeToken,
} from '../src/auth/jwt.js';

beforeAll(async () => {
  await seedIfEmpty();
});

describe('SAML SSO — honestly disabled without a real IdP configured in tests', () => {
  it('is disabled without SAML_IDP_METADATA_XML/SAML_SP_ENTITY_ID', () => {
    expect(samlSsoEnabled).toBe(false);
  });

  it('GET /auth/saml/config reports disabled — client hides the button', async () => {
    const res = await request(app).get('/api/auth/saml/config');
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
  });

  it('GET /auth/saml/login 404s rather than pretending to redirect anywhere real', async () => {
    const res = await request(app).get('/api/auth/saml/login');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_configured');
  });

  it('POST /auth/saml/acs redirects to the app with an error when disabled', async () => {
    const res = await request(app).post('/api/auth/saml/acs').send({ SAMLResponse: 'x', RelayState: 'y' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('samlError=nao_configurado');
  });
});

describe('SAML relay state/signup tokens — the stateless CSRF + pending-signup mechanism', () => {
  it('signs and verifies a relay state token, round-tripping the referral code', () => {
    const token = signSamlRelayState('REF123');
    const decoded = verifySamlRelayState(token);
    expect(decoded).toEqual({ referralCode: 'REF123' });
  });

  it('rejects a garbage token, and a real-but-differently-typed JWT, as SAML relay state', () => {
    expect(verifySamlRelayState('not-a-real-jwt')).toBeNull();
    // A 2FA challenge token is a real, validly-signed JWT — but the wrong `typ`, so it
    // must never be accepted as SAML relay state (same cross-token-type rejection
    // principle documented in auth/jwt.ts for the access-token/challenge-token boundary).
    const challengeToken = signChallengeToken(1);
    expect(verifySamlRelayState(challengeToken)).toBeNull();
  });

  it('signs and verifies a pending-signup token carrying the IdP-verified identity', () => {
    const token = signSamlSignupToken({ email: 'nova@empresa.com.br', nome: 'Nova Pessoa', samlSubjectId: 'saml-123', referralCode: null });
    const decoded = verifySamlSignupToken(token);
    expect(decoded).toEqual({ email: 'nova@empresa.com.br', nome: 'Nova Pessoa', samlSubjectId: 'saml-123', referralCode: null });
  });

  it('a signup token is never accepted as a real 2FA challenge token or vice versa', () => {
    const signupToken = signSamlSignupToken({ email: 'x@y.com', nome: 'X', samlSubjectId: 'saml-1' });
    expect(verifyChallengeToken(signupToken)).toBeNull();
  });
});

describe('POST /auth/saml/complete-signup', () => {
  it('rejects an invalid/expired signup token', async () => {
    const res = await request(app)
      .post('/api/auth/saml/complete-signup')
      .send({ signupToken: 'garbage-not-a-real-jwt-token', companyName: 'Empresa X', role: 'cedente' });
    expect(res.status).toBe(401);
  });

  it('rejects when the email was claimed in the meantime', async () => {
    const signupToken = signSamlSignupToken({ email: 'cedente@lastro.demo', nome: 'Alguém', samlSubjectId: 'saml-clash-1' });
    const res = await request(app)
      .post('/api/auth/saml/complete-signup')
      .send({ signupToken, companyName: 'Empresa X', role: 'cedente' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('email_taken');
  });

  it('requires an insurerKey for the seguradora role', async () => {
    const signupToken = signSamlSignupToken({ email: `nova-${Date.now()}@example.com`, nome: 'Nova', samlSubjectId: `saml-${Date.now()}` });
    const res = await request(app)
      .post('/api/auth/saml/complete-signup')
      .send({ signupToken, companyName: 'Seguradora Nova', role: 'seguradora' });
    expect(res.status).toBe(400);
  });

  it('creates a real, login-capable account from a valid signup token', async () => {
    const email = `nova-saml-${Date.now()}@example.com`;
    const signupToken = signSamlSignupToken({ email, nome: 'Pessoa SSO', samlSubjectId: `saml-${Date.now()}-unique` });
    const res = await request(app)
      .post('/api/auth/saml/complete-signup')
      .send({ signupToken, companyName: 'Empresa via SSO Ltda', role: 'cedente' });
    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.email).toBe(email);
    expect(res.body.user.companyName).toBe('Empresa via SSO Ltda');

    // The token proves account creation actually worked — a real, usable session.
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${res.body.token}`);
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(email);
  });

  it('the same signup token cannot be replayed to create a second account', async () => {
    const email = `replay-saml-${Date.now()}@example.com`;
    const signupToken = signSamlSignupToken({ email, nome: 'Replay', samlSubjectId: `saml-replay-${Date.now()}` });
    const first = await request(app)
      .post('/api/auth/saml/complete-signup')
      .send({ signupToken, companyName: 'Primeira Ltda', role: 'cedente' });
    expect(first.status).toBe(201);
    const second = await request(app)
      .post('/api/auth/saml/complete-signup')
      .send({ signupToken, companyName: 'Segunda Ltda', role: 'investidor' });
    expect(second.status).toBe(409);
  });
});
