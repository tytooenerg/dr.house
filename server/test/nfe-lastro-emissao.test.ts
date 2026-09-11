import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { db } from '../src/db/index.js';
import { vencimentoFuturo } from './helpers/datas.js';

// Segundo pilar do lastro real, junto do CNPJ do sacado (ver cnpj-lastro-emissao.test.ts):
// a chave de acesso de uma NF-e sempre precisou ter 44 dígitos (NFE_CHAVE_RE em
// emitirCore.ts), mas nunca teve seu dígito verificador oficial conferido — uma chave
// inventada com o tamanho certo passava despercebida. lib/nfeStatus.ts fecha essa
// lacuna com um alerta de compliance não-bloqueante, mesmo padrão do CNPJ.

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function registerCedente() {
  const email = `ced-nfe-lastro-${unique()}@example.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Cedente NF-e Lastro', email, password: 'senha123', companyName: `Empresa NF-e Lastro ${unique()}`, role: 'cedente' });
  return res.body.token as string;
}

async function emitir(token: string, nfeChave: string) {
  const form = {
    sacado: `Sacado NF-e Lastro ${unique()}`,
    cnpj: '11.444.777/0001-61',
    valor: '10.000',
    vencimento: vencimentoFuturo(),
    seguro: false,
    nfAnexada: true,
    nfeChave,
    batchValores: [],
  };
  let res = await request(app).post('/api/emitir/submit').set('Authorization', `Bearer ${token}`).send(form);
  // Retry past registradora's ~12% simulated instability, mesmo padrão de emitir.test.ts.
  for (let i = 0; i < 8 && res.status !== 200; i++) {
    res = await request(app)
      .post('/api/emitir/submit')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...form, nfeChave }); // mesma chave — este teste não é sobre duplicidade
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

describe('lastro real da NF-e, na emissão', () => {
  it('chave de 44 dígitos que não bate no dígito verificador oficial gera um alerta — mas não bloqueia a emissão', async () => {
    const token = await registerCedente();
    const duplicataId = await emitir(token, '9'.repeat(44));

    const alerts = alertsFor(duplicataId);
    const alert = alerts.find((a) => a.type === 'nfe_chave_invalida');
    expect(alert).toBeTruthy();
    expect(alert!.severity).toBe('atencao');
    expect(alert!.message).toContain('dígito verificador');

    // Nunca bloqueia: a emissão em si não falha (200, ver emitir() acima). Mas desde que o
    // checklist de lastro passou a exigir o dígito verificador de verdade, este item conta
    // como pendente — a duplicata fica em 'Pendente análise', não 'Aprovada'.
    const minhas = await request(app).get('/api/minhas').set('Authorization', `Bearer ${token}`);
    const own = (minhas.body.duplicatas as { id: string; status: string }[]).find((d) => d.id === duplicataId);
    expect(own!.status).toBe('Pendente análise');
  });

  it('chave que bate no dígito verificador oficial não gera alerta nenhum', async () => {
    const token = await registerCedente();
    const duplicataId = await emitir(token, '35260109330001445500100000000461900000000464');

    expect(alertsFor(duplicataId).find((a) => a.type === 'nfe_chave_invalida')).toBeUndefined();
  });
});
