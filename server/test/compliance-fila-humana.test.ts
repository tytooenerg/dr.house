import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { vencimentoFuturo } from './helpers/datas.js';

// Achado do teste de operação real (scripts/operacao-real): a fila de revisão de compliance
// enchia com duplicatas que o próprio motor tinha AUTO-APROVADO, e elas não saíam nunca.
//
// A cadeia era esta: emitirCore grava uma linha em compliance_engine_results pra toda
// emissão, com reviewed = 0; listPendingComplianceReview devolvia tudo que tinha reviewed = 0;
// e o único jeito de marcar revisado (POST /admin/compliance-queue/:id/decidir) exige que a
// duplicata esteja em 'suspensa_compliance'. Uma duplicata auto-aprovada nunca esteve, então
// entrava na fila e ficava — o admin recebia 404 se tentasse decidir sobre ela.
//
// Na operação real isso apareceu do jeito mais claro possível: o painel do auditor mostrava
// "Compliance pendente: 1" apontando pra uma duplicata que já tinha sido emitida, aceita,
// leiloada, vendida no balcão e PAGA. Uma fila que só cresce não é uma fila — é ruído que
// esconde o único item que precisa de um humano.

beforeAll(async () => {
  await seedIfEmpty();
});

const unico = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;

async function adminToken() {
  const res = await request(app).post('/api/auth/login').send({ email: 'admin@lastro.demo', password: 'demo1234' });
  return res.body.token as string;
}

async function registrarCedente() {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Cedente', email: `ced-${unico()}@example.com`, password: 'senha123', companyName: `Fornecedora ${unico()} Ltda`, role: 'cedente' });
  return res.body.token as string;
}

async function emitir(token: string, over: Partial<{ sacado: string; cnpj: string; valor: string }> = {}) {
  let body: Record<string, unknown> = {};
  for (let tentativa = 0; tentativa < 10; tentativa++) {
    const res = await request(app)
      .post('/api/emitir/submit')
      .set('Authorization', `Bearer ${token}`)
      .send({
        sacado: over.sacado ?? `Sacado ${unico()}`,
        cnpj: over.cnpj ?? '44.333.222/0001-11',
        valor: over.valor ?? '10.000',
        vencimento: vencimentoFuturo(),
        seguro: false,
        nfAnexada: true,
        batchValores: [],
      });
    body = res.body;
    if (res.status === 200) break;
  }
  return body as { duplicataId: string; complianceSuspensa: boolean };
}

async function fila(admin: string) {
  const res = await request(app).get('/api/admin/compliance-queue').set('Authorization', `Bearer ${admin}`);
  expect(res.status).toBe(200);
  return res.body.pending as { duplicataId: string }[];
}

describe('fila de compliance: só entra quem espera um humano', () => {
  it('uma emissão auto-aprovada NÃO entra na fila de revisão — nem no back-office, nem no painel do auditor', async () => {
    const admin = await adminToken();
    const cedente = await registrarCedente();

    const emissao = await emitir(cedente);
    expect(emissao.complianceSuspensa).toBe(false);

    expect(
      (await fila(admin)).map((p) => p.duplicataId),
      'uma duplicata que o motor liberou sozinho não tem o que ser revisado — e nenhum endpoint conseguiria tirá-la daqui depois'
    ).not.toContain(emissao.duplicataId);

    // O painel do auditor lê a mesma fonte (lib/auditorOverview.ts), então o achado aparecia
    // nos dois lugares e some nos dois.
    const auditorLogin = await request(app).post('/api/auth/login').send({ email: 'auditor@lastro.demo', password: 'demo1234' });
    const painel = await request(app).get('/api/auditor/overview').set('Authorization', `Bearer ${auditorLogin.body.token}`);
    expect(painel.status).toBe(200);
    expect(painel.body.compliance.itens.map((i: { duplicataId: string }) => i.duplicataId)).not.toContain(emissao.duplicataId);
  });

  it('uma emissão suspensa pelo motor entra na fila, e sai quando o admin decide', async () => {
    const admin = await adminToken();

    // Threshold no mínimo: mesmo uma emissão limpa pontua acima (CNPJ sem histórico já soma),
    // que é como compliance-threshold.test.ts força a suspensão sem fabricar um cenário falso.
    const baixar = await request(app).put('/api/admin/compliance-threshold').set('Authorization', `Bearer ${admin}`).send({ threshold: 1 });
    expect(baixar.status).toBe(200);
    try {
      const cedente = await registrarCedente();
      const emissao = await emitir(cedente, { sacado: `Nunca Vista ${unico()}`, cnpj: '11.222.333/0001-44' });
      expect(emissao.complianceSuspensa).toBe(true);

      expect((await fila(admin)).map((p) => p.duplicataId)).toContain(emissao.duplicataId);

      const decidir = await request(app)
        .post(`/api/admin/compliance-queue/${emissao.duplicataId}/decidir`)
        .set('Authorization', `Bearer ${admin}`)
        .send({ decision: 'liberado', note: 'Revisado: sacado novo, documentação conferida.' });
      expect(decidir.status).toBe(200);

      // Sai da fila porque um humano decidiu — o caminho que a auto-aprovada nunca teve.
      expect((await fila(admin)).map((p) => p.duplicataId)).not.toContain(emissao.duplicataId);
    } finally {
      await request(app).put('/api/admin/compliance-threshold').set('Authorization', `Bearer ${admin}`).send({ threshold: 80 });
    }
  });
});
