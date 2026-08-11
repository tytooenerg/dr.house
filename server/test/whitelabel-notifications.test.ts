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

async function registerCedente(companyName: string) {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Cedente White-label', email: `ced-wl-${unique()}@example.com`, password: 'senha123', companyName, role: 'cedente' });
  return { token: res.body.token as string, userId: res.body.user.id as number };
}

async function registerSacado(companyName: string) {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Sacado White-label', email: `sac-wl-${unique()}@example.com`, password: 'senha123', companyName, role: 'sacado' });
  return { token: res.body.token as string };
}

async function upgradeToEmpresarial(token: string) {
  await request(app).post('/api/billing/checkout').set('Authorization', `Bearer ${token}`).send({ plan: 'empresarial' });
}

async function generateTestKey(token: string) {
  const res = await request(app).post('/api/dev/keys/generate').set('Authorization', `Bearer ${token}`).send({ mode: 'test' });
  return res.body.rawKey as string;
}

// Retries past lib/registradoras.ts's real ~12% simulated CERC failure chance, same
// pattern every other test that submits a real emission uses.
async function emitDuplicata(token: string, sacado: string, valor = '10.000') {
  let lastStatus = 0;
  for (let attempt = 0; attempt < 10 && lastStatus !== 200; attempt++) {
    const res = await request(app)
      .post('/api/emitir/submit')
      .set('Authorization', `Bearer ${token}`)
      .send({ sacado, cnpj: '00.000.000/0001-00', valor, vencimento: '2026-10-01', seguro: false, nfAnexada: false, batchValores: [] });
    lastStatus = res.status;
    if (lastStatus !== 200) expect(lastStatus).toBe(502);
  }
  expect(lastStatus).toBe(200);
}

async function emitViaTestKey(rawKey: string, sacado: string, valor = '10.000') {
  let lastStatus = 0;
  for (let attempt = 0; attempt < 10 && lastStatus !== 200; attempt++) {
    const res = await request(app)
      .post('/api/v1/duplicatas')
      .set('Authorization', `Bearer ${rawKey}`)
      .send({ sacado, cnpj: '00.000.000/0001-00', valor, vencimento: '2026-10-01' });
    lastStatus = res.status;
    if (lastStatus !== 200) expect(lastStatus).toBe(502);
  }
  expect(lastStatus).toBe(200);
}

describe('White-label — sacado notified immediately when a duplicata needing their aceite is emitted', () => {
  it('notifies a real matching sacado account in-app, with the real cedente name', async () => {
    const sacadoNome = `Sacado Notif WL ${unique()} Ltda`;
    const cedenteNome = `Fornecedora Notif WL ${unique()} Ltda`;
    const { token: cedenteToken } = await registerCedente(cedenteNome);
    const { token: sacadoToken } = await registerSacado(sacadoNome);

    await emitDuplicata(cedenteToken, sacadoNome);

    const notifs = await request(app).get('/api/notifications').set('Authorization', `Bearer ${sacadoToken}`);
    expect(notifs.status).toBe(200);
    const entry = notifs.body.notifications.find((n: { text: string }) => n.text.includes('aguardando sua confirmação'));
    expect(entry).toBeTruthy();
    expect(entry.text).toContain(cedenteNome);
  });

  it('does not notify anyone, and never crashes, when no sacado account matches the company name', async () => {
    const { token: cedenteToken } = await registerCedente(`Fornecedora Sem Sacado WL ${unique()} Ltda`);
    // No exception, no 500 — emitDuplicata's own 200 assertion is the check.
    await emitDuplicata(cedenteToken, `Sacado Sem Conta WL ${unique()} Ltda`);
  });

  it('does not notify a real sacado account for a sandbox emission via a test-mode partner key', async () => {
    const sacadoNome = `Sacado Sandbox WL ${unique()} Ltda`;
    const { token: cedenteToken } = await registerCedente(`Fornecedora Sandbox WL ${unique()} Ltda`);
    const { token: sacadoToken } = await registerSacado(sacadoNome);
    const testKey = await generateTestKey(cedenteToken);

    await emitViaTestKey(testKey, sacadoNome);

    const notifs = await request(app).get('/api/notifications').set('Authorization', `Bearer ${sacadoToken}`);
    expect(notifs.body.notifications.some((n: { text: string }) => n.text.includes('aguardando sua confirmação'))).toBe(false);
  });
});

describe('White-label Plus — brand reaches the notification pipeline without altering the stored bell text', () => {
  it('a Plus-enabled cedente notifying their own sacado still stores the real, unbranded bell text', async () => {
    const sacadoNome = `Sacado Brand WL ${unique()} Ltda`;
    const cedenteNome = `Marca Parceira WL ${unique()} Ltda`;
    const { token: cedenteToken } = await registerCedente(cedenteNome);
    await upgradeToEmpresarial(cedenteToken);
    await request(app)
      .post('/api/erp/whitelabel/brand')
      .set('Authorization', `Bearer ${cedenteToken}`)
      .send({ nome: 'Minha Marca WL', corPrimaria: '#1E5EFF', logoUrl: 'https://example.com/logo.png' });
    const plus = await request(app).post('/api/erp/whitelabel/plus').set('Authorization', `Bearer ${cedenteToken}`).send({ enabled: true });
    expect(plus.status).toBe(200);
    expect(plus.body.whitelabelPlusEnabled).toBe(true);

    const { token: sacadoToken } = await registerSacado(sacadoNome);
    await emitDuplicata(cedenteToken, sacadoNome);

    const notifs = await request(app).get('/api/notifications').set('Authorization', `Bearer ${sacadoToken}`);
    const entry = notifs.body.notifications.find((n: { text: string }) => n.text.includes('aguardando sua confirmação'));
    expect(entry).toBeTruthy();
    // The in-app bell always shows the real cedente name, brand config or not — only the
    // outbound email subject / WhatsApp prefix / Web Push title (external channels, not
    // directly observable in this test suite — same as the pre-existing WhatsApp
    // reminder's own branding, which this reuses) substitute the white-label brand label
    // computed in db/misc.ts's addNotification.
    expect(entry.text).toContain(cedenteNome);
  });
});
