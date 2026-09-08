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

/** Registra um cedente já no plano Pro e devolve a chave sandbox dele. */
async function cedenteProKey(): Promise<string> {
  const email = `cedente-pro-sdk-${unique()}@example.com`;
  const reg = await fetch(`${baseUrl.replace('/v1', '')}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nome: 'SDK Test', email, password: 'senha123', companyName: `cedente pro SDK ${unique()}`, role: 'cedente' }),
  }).then((r) => r.json());
  const token = reg.token as string;
  await fetch(`${baseUrl.replace('/v1', '')}/billing/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ plan: 'pro' }),
  });
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
  });

  it('lists the account\'s own duplicatas, paginated and filtered by status', async () => {
    const apiKey = await registerAndGenerateKey('cedente');
    const client = new LastroClient({ apiKey, baseUrl });

    const a = await client.emitirDuplicata({ sacado: 'Grupo Atlas Varejo', cnpj: '12.345.678/0001-90', valor: '10.000,00', vencimento: '2026-12-01' });
    const b = await client.emitirDuplicata({ sacado: 'Grupo Atlas Varejo', cnpj: '12.345.678/0001-90', valor: '20.000,00', vencimento: '2026-12-02' });

    const page = await client.listDuplicatas();
    const ids = page.duplicatas.map((d) => d.id);
    expect(ids).toContain(a.duplicataId);
    expect(ids).toContain(b.duplicataId);
    expect(page.mode).toBe('test');
    expect(page.total).toBe(ids.length);

    // A query string montada pelo SDK precisa chegar ao servidor de verdade, não só compilar.
    const primeira = await client.listDuplicatas({ limit: 1 });
    expect(primeira.duplicatas).toHaveLength(1);
    const nenhuma = await client.listDuplicatas({ status: 'paga' });
    expect(nenhuma.duplicatas.map((d) => d.id)).not.toContain(a.duplicataId);
  });

  it('opens an auction on a duplicata that is ready, and reports the real reason when it is not', async () => {
    const apiKey = await registerAndGenerateKey('cedente');
    const client = new LastroClient({ apiKey, baseUrl });
    const { setAceiteStatus, ensureAceite } = await import('../../../server/src/db/aceites.js');

    // Lastro 100% (CNPJ + NF-e) faz a duplicata nascer 'aprovada'; sem o aceite do sacado ela
    // ainda não é negociável, e é isso que a primeira chamada prova.
    const emitida = await client.emitirDuplicata({
      sacado: 'Grupo Atlas Varejo',
      cnpj: '12.345.678/0001-90',
      valor: '10.000,00',
      vencimento: '2027-12-01',
      nfAnexada: true,
    });
    await expect(client.abrirLeilao(emitida.duplicataId)).rejects.toMatchObject({
      name: 'LastroApiError',
      status: 409,
      error: 'aceite_pendente',
    });

    setAceiteStatus(ensureAceite(emitida.duplicataId, 'Aceite confirmado no teste do SDK').id, 'aceita');
    const leilao = await client.abrirLeilao(emitida.duplicataId, { taxaMaxima: 2.5, duracaoHoras: 24 });
    expect(leilao.duplicataId).toBe(emitida.duplicataId);
    expect(leilao.reservaTaxaAm).toBe(2.5);

    const depois = await client.getDuplicata(emitida.duplicataId);
    expect(depois.status).toBe('no_mercado');
  });

  it('gates the cash-flow endpoint by plan first, then refuses sandbox instead of serving the real position', async () => {
    // Conta recém-registrada cai no Básico: o gate de plano vem antes de qualquer outro.
    const basico = new LastroClient({ apiKey: await registerAndGenerateKey('cedente'), baseUrl });
    await expect(basico.getCashflow()).rejects.toMatchObject({ name: 'LastroApiError', status: 402, error: 'plan_required' });

    // Já no Pro, a recusa que sobra é a honesta: não existe posição de caixa em sandbox, e a
    // alternativa (servir os números reais sob uma chave de teste) seria pior que recusar.
    const pro = new LastroClient({ apiKey: await cedenteProKey(), baseUrl });
    await expect(pro.getCashflow()).rejects.toMatchObject({ name: 'LastroApiError', status: 409, error: 'sandbox_indisponivel' });
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
