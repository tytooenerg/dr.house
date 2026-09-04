import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { db } from '../src/db/index.js';
import { getDuplicata } from '../src/db/duplicatas.js';
import { checkCollectionEligibility } from '../src/lib/legalCollection.js';

// Achado corrigido: POST /disputas/:id/resolve costumava deixar o próprio cedente
// encerrar sozinho qualquer disputa aberta contra ele — sem confirmação do sacado, sem
// revisão do admin — já restaurando o aceite pra 'aceita' e liberando
// checkCollectionEligibility (que exige aceite 'aceita'). Agora isso só registra uma
// proposta (POST /disputas/:id/propor); só o sacado confirmando (POST /:id/confirmar)
// ou recusando (POST /:id/recusar) — ou o admin arbitrando via /admin/disputes/:id/resolve
// (já coberto por admin-dispute-resolution.test.ts) — resolve de verdade.

function unique(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function register(role: 'cedente' | 'sacado', companyName: string) {
  const email = `${unique(role)}@example.com`;
  const res = await request(app).post('/api/auth/register').send({ nome: 'Teste', email, password: 'senha123', companyName, role });
  return res.body.token as string;
}

async function emitirEContestar(cedenteToken: string, sacadoToken: string, sacadoCompany: string) {
  let duplicataId = '';
  for (let attempt = 0; attempt < 8 && !duplicataId; attempt++) {
    const res = await request(app)
      .post('/api/emitir/submit')
      .set('Authorization', `Bearer ${cedenteToken}`)
      .send({ sacado: sacadoCompany, cnpj: '55.444.333/0001-22', valor: '25.000', vencimento: '2026-12-31', seguro: false, nfAnexada: true, batchValores: [] });
    if (res.status === 200) duplicataId = res.body.duplicataId;
  }
  expect(duplicataId).toBeTruthy();

  const aceites = await request(app).get('/api/aceites').set('Authorization', `Bearer ${sacadoToken}`);
  const aceite = aceites.body.aceites.find((a: { duplicataId: string }) => a.duplicataId === duplicataId);
  expect(aceite).toBeTruthy();

  const contest = await request(app).post(`/api/aceites/${aceite.id}/status`).set('Authorization', `Bearer ${sacadoToken}`).send({ status: 'contestada' });
  expect(contest.status).toBe(200);

  const disputes = await request(app).get('/api/disputas').set('Authorization', `Bearer ${cedenteToken}`);
  const dispute = disputes.body.disputes.find((d: { duplicataId: string }) => d.duplicataId === duplicataId);
  expect(dispute).toBeTruthy();

  return { duplicataId, aceiteId: aceite.id as number, disputeId: dispute.id as number };
}

describe('POST /disputas/:id/propor — autocomposição exige confirmação real do sacado', () => {
  it('uma proposta sozinha do cedente não muda o aceite nem libera cobrança jurídica', async () => {
    const sacadoCompany = unique('Sacado Proposta');
    const cedenteToken = await register('cedente', unique('Cedente Proposta'));
    const sacadoToken = await register('sacado', sacadoCompany);
    const { duplicataId, disputeId } = await emitirEContestar(cedenteToken, sacadoToken, sacadoCompany);

    const propor = await request(app).post(`/api/disputas/${disputeId}/propor`).set('Authorization', `Bearer ${cedenteToken}`).send({ note: 'reenviei a NF-e correta' });
    expect(propor.status).toBe(200);
    expect(propor.body.disputes[0].isProposed).toBe(true);

    // Vence a duplicata pra que a única coisa que ainda bloqueie cobrança jurídica seja
    // o aceite/disputa, não o prazo.
    db.prepare("UPDATE duplicatas SET vencimento = date('now', '-5 days') WHERE id = ?").run(duplicataId);
    const eligibility = checkCollectionEligibility(getDuplicata(duplicataId)!);
    expect(eligibility.eligible).toBe(false);
    expect(eligibility.reason).toMatch(/aceite|disputa/i);

    const aceites = await request(app).get('/api/aceites').set('Authorization', `Bearer ${sacadoToken}`);
    expect(aceites.body.aceites.find((a: { duplicataId: string }) => a.duplicataId === duplicataId).status).toBe('contestada');
  });

  it('sacado confirmando a proposta restaura o aceite e libera cobrança jurídica de verdade', async () => {
    const sacadoCompany = unique('Sacado Confirma');
    const cedenteToken = await register('cedente', unique('Cedente Confirma'));
    const sacadoToken = await register('sacado', sacadoCompany);
    const { duplicataId, disputeId } = await emitirEContestar(cedenteToken, sacadoToken, sacadoCompany);

    await request(app).post(`/api/disputas/${disputeId}/propor`).set('Authorization', `Bearer ${cedenteToken}`).send({ note: 'reenviei a NF-e correta' });

    const sacadoView = await request(app).get('/api/aceites').set('Authorization', `Bearer ${sacadoToken}`);
    const item = sacadoView.body.aceites.find((a: { duplicataId: string }) => a.duplicataId === duplicataId);
    expect(item.disputeProposal.disputeId).toBe(disputeId);
    expect(item.disputeProposal.note).toBe('reenviei a NF-e correta');

    const confirm = await request(app).post(`/api/disputas/${disputeId}/confirmar`).set('Authorization', `Bearer ${sacadoToken}`);
    expect(confirm.status).toBe(200);

    const afterConfirm = await request(app).get('/api/aceites').set('Authorization', `Bearer ${sacadoToken}`);
    expect(afterConfirm.body.aceites.find((a: { duplicataId: string }) => a.duplicataId === duplicataId).status).toBe('aceita');

    db.prepare("UPDATE duplicatas SET vencimento = date('now', '-5 days') WHERE id = ?").run(duplicataId);
    const eligibility = checkCollectionEligibility(getDuplicata(duplicataId)!);
    expect(eligibility.eligible).toBe(true);
  });

  it('sacado recusando mantém a disputa aberta e o aceite contestado', async () => {
    const sacadoCompany = unique('Sacado Recusa');
    const cedenteToken = await register('cedente', unique('Cedente Recusa'));
    const sacadoToken = await register('sacado', sacadoCompany);
    const { duplicataId, disputeId } = await emitirEContestar(cedenteToken, sacadoToken, sacadoCompany);

    await request(app).post(`/api/disputas/${disputeId}/propor`).set('Authorization', `Bearer ${cedenteToken}`).send({ note: 'proposta insuficiente' });

    const recusar = await request(app).post(`/api/disputas/${disputeId}/recusar`).set('Authorization', `Bearer ${sacadoToken}`);
    expect(recusar.status).toBe(200);

    const stillOpen = await request(app).get('/api/disputas').set('Authorization', `Bearer ${cedenteToken}`);
    const dispute = stillOpen.body.disputes.find((d: { id: number }) => d.id === disputeId);
    expect(dispute).toBeTruthy(); // ainda aberta, disponível pro admin arbitrar
    expect(dispute.isProposed).toBe(false); // proposta recusada foi limpa

    const aceites = await request(app).get('/api/aceites').set('Authorization', `Bearer ${sacadoToken}`);
    expect(aceites.body.aceites.find((a: { duplicataId: string }) => a.duplicataId === duplicataId).status).toBe('contestada');
  });

  it('um sacado de outra empresa não pode confirmar nem recusar a proposta de terceiros', async () => {
    const sacadoCompany = unique('Sacado Dono');
    const cedenteToken = await register('cedente', unique('Cedente Terceiro'));
    const sacadoToken = await register('sacado', sacadoCompany);
    const otherSacadoToken = await register('sacado', unique('Sacado Estranho'));
    const { disputeId } = await emitirEContestar(cedenteToken, sacadoToken, sacadoCompany);

    await request(app).post(`/api/disputas/${disputeId}/propor`).set('Authorization', `Bearer ${cedenteToken}`);

    const confirmAttempt = await request(app).post(`/api/disputas/${disputeId}/confirmar`).set('Authorization', `Bearer ${otherSacadoToken}`);
    expect(confirmAttempt.status).toBe(404);
    const recusarAttempt = await request(app).post(`/api/disputas/${disputeId}/recusar`).set('Authorization', `Bearer ${otherSacadoToken}`);
    expect(recusarAttempt.status).toBe(404);
  });
});
