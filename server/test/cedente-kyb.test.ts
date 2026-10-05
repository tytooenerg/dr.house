import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { vencimentoFuturo } from './helpers/datas.js';

// KYB documental do cedente — quem recebe o dinheiro antecipado passa a precisar provar
// que a empresa existe de verdade antes de emitir, mesma exigência que o investidor já
// tinha pra dar lance. Fica atrás do feature flag 'cedente_kyb_required' (desligado por
// padrão, lib/featureFlags.ts) justamente pra não quebrar os ~50 arquivos de teste que já
// registram um cedente e emitem na hora, e pra dar ao admin controle de quando a exigência
// passa a valer de verdade em produção.

beforeAll(async () => {
  await seedIfEmpty();
});

const MINIMAL_PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function loginAdmin() {
  const res = await request(app).post('/api/auth/login').send({ email: 'admin@lastro.demo', password: 'demo1234' });
  return res.body.token as string;
}

async function setCedenteKybFlag(enabled: boolean) {
  const adminToken = await loginAdmin();
  const res = await request(app)
    .post('/api/admin/feature-flags/cedente_kyb_required')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ enabled, rolloutPct: 100 });
  expect(res.status).toBe(200);
}

async function registerCedente() {
  const email = `ced-kyb-${unique()}@example.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Cedente KYB', email, password: 'senha123', companyName: `Empresa KYB ${unique()}`, role: 'cedente' });
  return { token: res.body.token as string, userId: res.body.user.id as number };
}

function emitirPayload() {
  return {
    sacado: `Sacado KYB ${unique()}`,
    cnpj: '',
    valor: '8.000',
    vencimento: vencimentoFuturo(),
    seguro: false,
    nfAnexada: false,
    batchValores: [],
  };
}

async function uploadKybDoc(token: string, kind: string, filename: string) {
  return request(app).post('/api/uploads').set('Authorization', `Bearer ${token}`).field('kind', kind).attach('file', MINIMAL_PDF, { filename, contentType: 'application/pdf' });
}

describe('KYB documental do cedente (feature flag cedente_kyb_required)', () => {
  it('desligado por padrão: um cedente novo, sem nenhum documento, emite normalmente', async () => {
    const { token } = await registerCedente();
    const res = await request(app).post('/api/emitir/submit').set('Authorization', `Bearer ${token}`).send(emitirPayload());
    expect(res.status).not.toBe(403);
  });

  it('ligado: bloqueia a emissão de um cedente novo que ainda não completou o credenciamento', async () => {
    await setCedenteKybFlag(true);
    try {
      const { token } = await registerCedente();
      const res = await request(app).post('/api/emitir/submit').set('Authorization', `Bearer ${token}`).send(emitirPayload());
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('kyb_required');
    } finally {
      await setCedenteKybFlag(false);
    }
  });

  it('ligado: a conta demo (já existente) continua emitindo normalmente — grandfathered', async () => {
    await setCedenteKybFlag(true);
    try {
      const login = await request(app).post('/api/auth/login').send({ email: 'cedente@lastro.demo', password: 'demo1234' });
      const res = await request(app).post('/api/emitir/submit').set('Authorization', `Bearer ${login.body.token}`).send(emitirPayload());
      expect(res.status).not.toBe(403);
    } finally {
      await setCedenteKybFlag(false);
    }
  });

  it('rejeita o envio para análise antes dos 3 documentos estarem completos', async () => {
    const { token } = await registerCedente();
    await uploadKybDoc(token, 'kyb_cedente_cnpj', 'cnpj.pdf');
    const res = await request(app).post('/api/auth/kyb/cedente').set('Authorization', `Bearer ${token}`).send({ cnpj: '12.345.678/0001-95' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('documentos_pendentes');
  });

  it('fluxo completo: 3 documentos → envia para análise (pending) → admin aprova → emissão libera', async () => {
    await setCedenteKybFlag(true);
    try {
      const { token, userId } = await registerCedente();

      // Ainda sem nenhum documento: bloqueado.
      let res = await request(app).post('/api/emitir/submit').set('Authorization', `Bearer ${token}`).send(emitirPayload());
      expect(res.status).toBe(403);

      await uploadKybDoc(token, 'kyb_cedente_cnpj', 'cnpj.pdf');
      await uploadKybDoc(token, 'kyb_cedente_contrato_social', 'contrato.pdf');
      await uploadKybDoc(token, 'kyb_cedente_representante', 'representante.pdf');

      const submit = await request(app).post('/api/auth/kyb/cedente').set('Authorization', `Bearer ${token}`).send({ cnpj: '12.345.678/0001-95' });
      expect(submit.status).toBe(200);
      expect(submit.body.user.kybStatus).toBe('pending');

      // Pendente ainda bloqueia — só 'approved' libera.
      res = await request(app).post('/api/emitir/submit').set('Authorization', `Bearer ${token}`).send(emitirPayload());
      expect(res.status).toBe(403);

      // A fila do admin mostra os 3 documentos e o papel certo.
      const adminToken = await loginAdmin();
      const queue = await request(app).get('/api/admin/kyb').set('Authorization', `Bearer ${adminToken}`);
      const entry = (queue.body.pending as { id: number; role: string; cedenteDocs: { cnpj: string | null } | null }[]).find((p) => p.id === userId);
      expect(entry?.role).toBe('cedente');
      expect(entry?.cedenteDocs?.cnpj).toBe('cnpj.pdf');

      await request(app).post(`/api/admin/kyb/${userId}/approve`).set('Authorization', `Bearer ${adminToken}`);

      res = await request(app).post('/api/emitir/submit').set('Authorization', `Bearer ${token}`).send(emitirPayload());
      expect(res.status).not.toBe(403);
    } finally {
      await setCedenteKybFlag(false);
    }
  });
});
