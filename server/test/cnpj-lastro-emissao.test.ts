import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { db } from '../src/db/index.js';
import { vencimentoFuturo } from './helpers/datas.js';

// O checklist de lastro em Emitir Duplicata sempre marcou "Dados do sacado e CNPJ" como
// concluído só por o campo não estar vazio — nunca conferiu se aquele CNPJ é uma empresa
// real. lib/cnpjLookup.ts fecha a primeira metade dessa lacuna (dígito verificador oficial
// da Receita Federal, sempre ativo, sem depender de rede) e emitirCore.ts agora levanta um
// alerta de compliance — visível pro back-office, nunca bloqueia a emissão sozinho —
// quando o CNPJ do sacado não bate no dígito verificador.

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function registerCedente() {
  const email = `ced-cnpj-lastro-${unique()}@example.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Cedente CNPJ Lastro', email, password: 'senha123', companyName: `Empresa CNPJ Lastro ${unique()}`, role: 'cedente' });
  return res.body.token as string;
}

async function emitir(token: string, cnpj: string) {
  let res = await request(app)
    .post('/api/emitir/submit')
    .set('Authorization', `Bearer ${token}`)
    .send({ sacado: `Sacado CNPJ Lastro ${unique()}`, cnpj, valor: '10.000', vencimento: vencimentoFuturo(), seguro: false, nfAnexada: true, batchValores: [] });
  // Retry past registradora's ~12% simulated instability, mesmo padrão de emitir.test.ts.
  for (let i = 0; i < 8 && res.status !== 200; i++) {
    res = await request(app)
      .post('/api/emitir/submit')
      .set('Authorization', `Bearer ${token}`)
      .send({ sacado: `Sacado CNPJ Lastro ${unique()}`, cnpj, valor: '10.000', vencimento: vencimentoFuturo(), seguro: false, nfAnexada: true, batchValores: [] });
  }
  expect(res.status).toBe(200);
  return res.body.duplicataId as string;
}

function alertsFor(duplicataId: string) {
  return db.prepare('SELECT type, severity, message FROM compliance_alerts WHERE duplicata_id = ?').all(duplicataId) as {
    type: string;
    severity: string;
    message: string;
  }[];
}

describe('lastro real do CNPJ do sacado, na emissão', () => {
  it('CNPJ que não bate no dígito verificador oficial gera um alerta de compliance — mas não bloqueia a emissão', async () => {
    const token = await registerCedente();
    // Mesmo CNPJ de fixture usado em outros testes de leilão deste repositório — inválido
    // no dígito verificador, o que nunca foi checado antes desta mudança.
    const duplicataId = await emitir(token, '44.333.222/0001-11');

    const alerts = alertsFor(duplicataId);
    const cnpjAlert = alerts.find((a) => a.type === 'cnpj_invalido');
    expect(cnpjAlert).toBeTruthy();
    expect(cnpjAlert!.severity).toBe('atencao');
    expect(cnpjAlert!.message).toContain('dígito verificador');

    // Nunca bloqueia: a duplicata segue seu fluxo normal (aprovada, no lastro completo).
    const minhas = await request(app).get('/api/minhas').set('Authorization', `Bearer ${token}`);
    const own = (minhas.body.duplicatas as { id: string; status: string }[]).find((d) => d.id === duplicataId);
    expect(own!.status).toBe('Aprovada');
  });

  it('CNPJ que bate no dígito verificador oficial não gera alerta nenhum', async () => {
    const token = await registerCedente();
    const duplicataId = await emitir(token, '11.444.777/0001-61');

    expect(alertsFor(duplicataId).find((a) => a.type === 'cnpj_invalido')).toBeUndefined();
  });
});
