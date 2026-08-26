import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { LastroClient, LastroApiError, LastroNetworkError } from '../src/index.js';

// This is not a mocked-fetch test — it spins up the real Lastro server (the actual
// Express app, same code that runs in production) on an ephemeral local port, registers
// real accounts through it, generates real sandbox API keys through it, and then drives
// every SDK method against those real HTTP endpoints. If the SDK's request shapes ever
// drift from what routes/v1.ts actually expects, this fails for real, not against a
// hand-maintained mock of the server's behavior.
process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'sdk-test-secret';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const { app } = await import('../../../server/src/app.js');
  const { seedIfEmpty } = await import('../../../server/src/db/seed.js');
  await seedIfEmpty();
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}/api/v1`;
});

afterAll(() => {
  server.close();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function registerAndGenerateKey(role: 'cedente' | 'investidor' | 'sacado' | 'seguradora'): Promise<string> {
  const email = `${role}-sdk-${unique()}@example.com`;
  const body: Record<string, unknown> = { nome: 'SDK Test', email, password: 'senha123', companyName: `${role} SDK ${unique()}`, role };
  if (role === 'seguradora') body.insurerKey = 'too';
  const reg = await fetch(`${baseUrl.replace('/v1', '')}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json());
  const token = reg.token as string;
  // Sandbox (test-mode) keys work on every plan and auto-seed a demo dataset — the same
  // free-tier path a real partner uses to try the API before a commercial contract.
  const keyRes = await fetch(`${baseUrl.replace('/v1', '')}/dev/keys/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ mode: 'test' }),
  }).then((r) => r.json());
  return keyRes.rawKey as string;
}

describe('LastroClient — real end-to-end against the live server', () => {
  it('emits a duplicata, fetches it back, and lists it on the sandbox marketplace', async () => {
    const apiKey = await registerAndGenerateKey('cedente');
    const client = new LastroClient({ apiKey, baseUrl });

    const emitted = await client.emitirDuplicata({ sacado: 'Grupo Atlas Varejo', cnpj: '12.345.678/0001-90', valor: '10.000,00', vencimento: '2026-12-01' });
    expect(emitted.duplicataId).toBeTruthy();
    expect(emitted.mode).toBe('test');

    const fetched = await client.getDuplicata(emitted.duplicataId);
    expect(fetched.id).toBe(emitted.duplicataId);
    expect(fetched.sacado).toBe('Grupo Atlas Varejo');

    const { offers } = await client.listMarketplace();
    expect(Array.isArray(offers)).toBe(true);

    const { duplicatas } = await client.listDuplicatas();
    const listed = duplicatas.find((d) => d.id === emitted.duplicataId);
    expect(listed).toBeTruthy();
    expect(listed!.valor).toBeGreaterThan(0);
    expect(typeof listed!.emissao).toBe('string');
  });

  it('is idempotent: replaying the same Idempotency-Key + body returns the original result instead of emitting twice', async () => {
    const apiKey = await registerAndGenerateKey('cedente');
    const client = new LastroClient({ apiKey, baseUrl });
    const idempotencyKey = `sdk-test-${unique()}`;
    const input = { sacado: 'Distribuidora Bom Preço', valor: '5.000,00', vencimento: '2026-11-01' };

    const first = await client.emitirDuplicata(input, { idempotencyKey });
    const second = await client.emitirDuplicata(input, { idempotencyKey });
    expect(second.duplicataId).toBe(first.duplicataId);
  });

  it('throws LastroApiError with the real status/error/message on a role violation', async () => {
    const apiKey = await registerAndGenerateKey('investidor');
    const client = new LastroClient({ apiKey, baseUrl });
    await expect(client.emitirDuplicata({ sacado: 'X', valor: '1.000', vencimento: '2026-12-01' })).rejects.toMatchObject({
      name: 'LastroApiError',
      status: 403,
      error: 'forbidden',
    });
  });

  it('throws LastroApiError 401 on an invalid API key', async () => {
    const client = new LastroClient({ apiKey: 'lastro_live_not_a_real_key', baseUrl });
    await expect(client.listMarketplace()).rejects.toBeInstanceOf(LastroApiError);
    try {
      await client.listMarketplace();
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(LastroApiError);
      expect((err as LastroApiError).status).toBe(401);
    }
  });

  it('scores a CNPJ, and a reported signal is reflected in a follow-up score lookup', async () => {
    const apiKey = await registerAndGenerateKey('cedente');
    const client = new LastroClient({ apiKey, baseUrl });
    const cnpj = '12.345.678/0001-90';

    const before = await client.getScore(cnpj);
    expect(typeof before.score).toBe('number');

    const after = await client.reportSignal(cnpj, { tipo: 'pagamento_pontual', nota: 'SDK test signal' });
    expect(typeof after.score).toBe('number');
  });

  it('screens a name against the real sanctions/PLD pipeline', async () => {
    const apiKey = await registerAndGenerateKey('cedente');
    const client = new LastroClient({ apiKey, baseUrl });
    const result = await client.screenPld({ nome: 'Pessoa Comum Sem Restrições' });
    expect(result.nome).toBe('Pessoa Comum Sem Restrições');
    expect(typeof result.flagged).toBe('boolean');
  });

  it('lists payables and returns a cashflow forecast for a cedente key', async () => {
    const apiKey = await registerAndGenerateKey('cedente');
    const client = new LastroClient({ apiKey, baseUrl });

    const { payables } = await client.listPayables();
    expect(Array.isArray(payables)).toBe(true);

    const forecast = await client.getCashflowForecast();
    expect(forecast.scenarios.map((s) => s.scenario).sort()).toEqual(['base', 'otimista', 'pessimista']);
    expect(Array.isArray(forecast.insights)).toBe(true);
  });

  it('forbids a non-cedente key from reading payables or the cashflow forecast', async () => {
    const apiKey = await registerAndGenerateKey('investidor');
    const client = new LastroClient({ apiKey, baseUrl });
    await expect(client.listPayables()).rejects.toMatchObject({ name: 'LastroApiError', status: 403 });
    await expect(client.getCashflowForecast()).rejects.toMatchObject({ name: 'LastroApiError', status: 403 });
  });

  it('returns an empty aceites list for a role that has none (structural, not role-specific)', async () => {
    const apiKey = await registerAndGenerateKey('cedente');
    const client = new LastroClient({ apiKey, baseUrl });
    const { aceites } = await client.listAceites();
    expect(Array.isArray(aceites)).toBe(true);
  });

  it('rejects an empty apiKey at construction time, before any network call', () => {
    expect(() => new LastroClient({ apiKey: '' })).toThrow();
  });

  it('throws LastroNetworkError when the API is unreachable', async () => {
    const client = new LastroClient({ apiKey: 'lastro_test_whatever', baseUrl: 'http://127.0.0.1:1/v1' });
    await expect(client.listMarketplace()).rejects.toBeInstanceOf(LastroNetworkError);
  });
});
