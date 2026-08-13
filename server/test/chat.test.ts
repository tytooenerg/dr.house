import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function registerAndLogin(role: 'investidor' | 'cedente' = 'investidor') {
  const email = `chat-${unique()}@example.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Chat Tester', email, password: 'senha123', companyName: `Empresa ${unique()}`, role });
  return res.body.token as string;
}

describe('AI assistant (chat)', () => {
  it('requires auth', async () => {
    const res = await request(app).get('/api/chat');
    expect(res.status).toBe(401);
  });

  it('GET / returns suggestions and whether the real LLM is enabled', async () => {
    const token = await registerAndLogin();
    const res = await request(app).get('/api/chat').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.suggestions)).toBe(true);
    expect(res.body.suggestions.length).toBeGreaterThan(0);
    // No ANTHROPIC_API_KEY in the test environment (see test/setup.ts) — this must honestly
    // report the real, unconfigured state, not claim the LLM is available when it isn't.
    expect(res.body.llmEnabled).toBe(false);
  });

  it('rejects an empty or missing question with a validation error', async () => {
    const token = await registerAndLogin();
    const res = await request(app).post('/api/chat/ask').set('Authorization', `Bearer ${token}`).send({ question: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
  });

  it('falls back to a canned answer for a known suggestion when the LLM is unconfigured', async () => {
    const token = await registerAndLogin();
    const res = await request(app)
      .post('/api/chat/ask')
      .set('Authorization', `Bearer ${token}`)
      .send({ question: 'O que é deságio?' });
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('canned');
    expect(res.body.answer).toMatch(/deságio/i);
  });

  it("falls back to the generic 'no ready answer' message for a question outside the canned set", async () => {
    const token = await registerAndLogin();
    const res = await request(app)
      .post('/api/chat/ask')
      .set('Authorization', `Bearer ${token}`)
      .send({ question: `Pergunta totalmente fora do roteiro ${unique()}` });
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('canned');
    expect(res.body.answer).toMatch(/suporte@lastro\.com\.br/);
  });

  it('never crashes for a cedente asking a cashflow-shaped question — the AI CFO grounding path must degrade gracefully without a real LLM', async () => {
    const token = await registerAndLogin('cedente');
    const res = await request(app)
      .post('/api/chat/ask')
      .set('Authorization', `Bearer ${token}`)
      .send({ question: 'Quanto tenho disponível para antecipar hoje?' });
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('canned');
  });
});
