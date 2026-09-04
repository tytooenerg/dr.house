import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';

function unique(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function register(role: 'cedente' | 'sacado' | 'investidor', companyName: string) {
  const email = `${unique(role)}@example.com`;
  const res = await request(app).post('/api/auth/register').send({ nome: 'Teste', email, password: 'senha123', companyName, role });
  return res.body.token as string;
}

describe('Aceite → Disputa flow across cedente and sacado accounts', () => {
  it('lets a sacado see and contest a duplicata addressed to its own company, and the cedente resolve the dispute', async () => {
    const sacadoCompany = unique('Sacado Corp');
    const cedenteToken = await register('cedente', unique('Cedente Corp'));
    const sacadoToken = await register('sacado', sacadoCompany);

    // Cedente emits a duplicata against the sacado's exact company name.
    // Retry past the 12% simulated CERC failure chance (odds of 5 straight failures are negligible).
    let emitStatus = 0;
    for (let attempt = 0; attempt < 5 && emitStatus !== 200; attempt++) {
      const emit = await request(app)
        .post('/api/emitir/submit')
        .set('Authorization', `Bearer ${cedenteToken}`)
        .send({ sacado: sacadoCompany, cnpj: '11.111.111/0001-11', valor: '20.000', vencimento: '2026-11-01', seguro: false, nfAnexada: false, batchValores: [] });
      emitStatus = emit.status;
    }
    expect(emitStatus).toBe(200);

    // A different sacado account (different company) should NOT see this aceite.
    const otherSacadoToken = await register('sacado', unique('Outra Empresa'));
    const otherAceites = await request(app).get('/api/aceites').set('Authorization', `Bearer ${otherSacadoToken}`);
    expect(otherAceites.body.aceites).toHaveLength(0);

    // The matching sacado does see it, and can act on it (editable: true).
    const sacadoAceites = await request(app).get('/api/aceites').set('Authorization', `Bearer ${sacadoToken}`);
    expect(sacadoAceites.status).toBe(200);
    const pending = sacadoAceites.body.aceites.find((a: { status: string }) => a.status === 'aguardando');
    expect(pending).toBeTruthy();
    expect(pending.editable).toBe(true);

    // The cedente's own read-only view lists it too, but non-editable.
    const cedenteAceites = await request(app).get('/api/aceites').set('Authorization', `Bearer ${cedenteToken}`);
    const cedenteSide = cedenteAceites.body.aceites.find((a: { id: number }) => a.id === pending.id);
    expect(cedenteSide.editable).toBe(false);

    // Cedente cannot mark statuses — only the sacado can.
    const cedenteAttempt = await request(app).post(`/api/aceites/${pending.id}/status`).set('Authorization', `Bearer ${cedenteToken}`).send({ status: 'aceita' });
    expect(cedenteAttempt.status).toBe(403);

    // Sacado contests it.
    const contest = await request(app).post(`/api/aceites/${pending.id}/status`).set('Authorization', `Bearer ${sacadoToken}`).send({ status: 'contestada' });
    expect(contest.status).toBe(200);

    // A dispute now shows up for the cedente.
    const disputes = await request(app).get('/api/disputas').set('Authorization', `Bearer ${cedenteToken}`);
    expect(disputes.status).toBe(200);
    expect(disputes.body.disputes).toHaveLength(1);
    const dispute = disputes.body.disputes[0];
    expect(dispute.canSend).toBe(true);

    // Cedente sends evidence, then proposes a resolution — this alone never resolves the
    // dispute anymore (the old unilateral /resolve let the accused party close a dispute
    // against them with zero counterparty involvement; see server/test/dispute-proposal.test.ts
    // for the dedicated regression coverage of that fix).
    const evidence = await request(app).post(`/api/disputas/${dispute.id}/evidence`).set('Authorization', `Bearer ${cedenteToken}`);
    expect(evidence.status).toBe(200);
    expect(evidence.body.disputes[0].isSent).toBe(true);

    const propor = await request(app).post(`/api/disputas/${dispute.id}/propor`).set('Authorization', `Bearer ${cedenteToken}`);
    expect(propor.status).toBe(200);
    expect(propor.body.disputes).toHaveLength(1); // still open — a proposal alone doesn't resolve it
    expect(propor.body.disputes[0].isProposed).toBe(true);

    // The aceite stays 'contestada' until the sacado actually confirms.
    const stillContested = await request(app).get('/api/aceites').set('Authorization', `Bearer ${sacadoToken}`);
    expect(stillContested.body.aceites.find((a: { id: number }) => a.id === pending.id).status).toBe('contestada');

    // The sacado sees the proposal and confirms it — only now does the dispute resolve.
    const sacadoView = await request(app).get('/api/aceites').set('Authorization', `Bearer ${sacadoToken}`);
    const proposalSeen = sacadoView.body.aceites.find((a: { id: number }) => a.id === pending.id).disputeProposal;
    expect(proposalSeen).toBeTruthy();

    const confirm = await request(app).post(`/api/disputas/${proposalSeen.disputeId}/confirmar`).set('Authorization', `Bearer ${sacadoToken}`);
    expect(confirm.status).toBe(200);

    // Only a cedente-authenticated request lists the open queue (routes/disputas.ts's
    // GET / returns [] for any other role), so re-check via the cedente's own listing.
    const afterConfirm = await request(app).get('/api/disputas').set('Authorization', `Bearer ${cedenteToken}`);
    expect(afterConfirm.body.disputes).toHaveLength(0); // resolved disputes drop out of the open list

    // The underlying aceite is back to "aceita".
    const finalAceites = await request(app).get('/api/aceites').set('Authorization', `Bearer ${sacadoToken}`);
    const finalItem = finalAceites.body.aceites.find((a: { id: number }) => a.id === pending.id);
    expect(finalItem.status).toBe('aceita');
  });
});
