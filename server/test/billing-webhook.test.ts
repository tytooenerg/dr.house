import { describe, expect, it, beforeAll, vi } from 'vitest';
import Stripe from 'stripe';
import type { Request, Response } from 'express';

// This file must NOT statically import ../src/app.js or anything that transitively
// imports ../src/routes/billing.js — that module reads STRIPE_SECRET_KEY once at load
// time, and static imports are hoisted above any top-level env stubbing in the same
// file. We stub the env first, then dynamically import billing.js so it picks it up.
const FAKE_SECRET = 'sk_test_fake_for_signature_verification_only';
const WEBHOOK_SECRET = 'whsec_test_fake';
const PRICE_PRO = 'price_pro_test';

let handleStripeWebhook: typeof import('../src/routes/billing.js').handleStripeWebhook;
let getUserById: typeof import('../src/db/users.js').getUserById;
let createUser: typeof import('../src/db/users.js').createUser;
let setStripeCustomerId: typeof import('../src/db/users.js').setStripeCustomerId;
let hashPassword: typeof import('../src/auth/password.js').hashPassword;
let stripeForSigning: Stripe;

beforeAll(async () => {
  vi.stubEnv('STRIPE_SECRET_KEY', FAKE_SECRET);
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', WEBHOOK_SECRET);
  vi.stubEnv('STRIPE_PRICE_PRO', PRICE_PRO);

  const billingModule = await import('../src/routes/billing.js');
  handleStripeWebhook = billingModule.handleStripeWebhook;
  const usersModule = await import('../src/db/users.js');
  getUserById = usersModule.getUserById;
  createUser = usersModule.createUser;
  setStripeCustomerId = usersModule.setStripeCustomerId;
  const passwordModule = await import('../src/auth/password.js');
  hashPassword = passwordModule.hashPassword;

  stripeForSigning = new Stripe(FAKE_SECRET);
});

function mockRes() {
  const res = { statusCode: 200 as number, body: undefined as unknown } as unknown as Response & { statusCode: number; body: unknown };
  (res as unknown as { status: (n: number) => typeof res }).status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  (res as unknown as { json: (b: unknown) => typeof res }).json = (body: unknown) => {
    res.body = body;
    return res;
  };
  return res;
}

function signedRequest(eventBody: object): Request {
  const payload = JSON.stringify(eventBody);
  const signature = stripeForSigning.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  return { headers: { 'stripe-signature': signature }, body: payload } as unknown as Request;
}

describe('POST /api/billing/webhook (signature verification)', () => {
  it('rejects a payload with an invalid signature', async () => {
    const req = { headers: { 'stripe-signature': 'bad-signature' }, body: JSON.stringify({ type: 'ping' }) } as unknown as Request;
    const res = mockRes();
    await handleStripeWebhook(req, res);
    expect(res.statusCode).toBe(400);
  });

  it('updates the user plan to Pro on a real, correctly-signed customer.subscription.updated event', async () => {
    const passwordHash = await hashPassword('senha123');
    const user = createUser({
      email: `webhook-${Date.now()}@example.com`,
      passwordHash,
      nome: 'Cedente Webhook',
      companyName: 'Cedente Webhook Ltda',
      role: 'cedente',
    });
    setStripeCustomerId(user.id, 'cus_test_webhook');

    const event = {
      id: 'evt_test_1',
      object: 'event',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_test_1',
          customer: 'cus_test_webhook',
          status: 'active',
          items: { data: [{ price: { id: PRICE_PRO }, current_period_end: 1893456000 }] },
        },
      },
    };

    const req = signedRequest(event);
    const res = mockRes();
    await handleStripeWebhook(req, res);

    expect(res.statusCode).toBe(200);
    const updated = getUserById(user.id)!;
    expect(updated.plan).toBe('pro');
    expect(updated.subscription_status).toBe('active');
    expect(updated.stripe_subscription_id).toBe('sub_test_1');
  });

  it('downgrades to básico on customer.subscription.deleted', async () => {
    const passwordHash = await hashPassword('senha123');
    const user = createUser({
      email: `webhook-cancel-${Date.now()}@example.com`,
      passwordHash,
      nome: 'Cedente Cancelado',
      companyName: 'Cedente Cancelado Ltda',
      role: 'cedente',
    });
    setStripeCustomerId(user.id, 'cus_test_cancel');

    const event = {
      id: 'evt_test_2',
      object: 'event',
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_test_2', customer: 'cus_test_cancel' } },
    };

    const req = signedRequest(event);
    const res = mockRes();
    await handleStripeWebhook(req, res);

    expect(res.statusCode).toBe(200);
    const updated = getUserById(user.id)!;
    expect(updated.plan).toBe('basico');
    expect(updated.subscription_status).toBe('canceled');
  });
});
