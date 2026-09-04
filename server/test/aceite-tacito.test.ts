import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { db } from '../src/db/index.js';
import { applyTacitAcceptance } from '../src/lib/aceiteCore.js';

// Achado corrigido: a UI (AceitePage.tsx) e o texto de compliance (data/seed.ts's
// FINANCIADOR_REQS: "sacado tem até... 15 para aceitar — sem isso, a validade plena
// fica em risco") sempre prometeram "aceite tácito" quando o prazo vence sem
// manifestação do sacado — mas decideAceite nunca checava prazo_limite, e não existia
// nenhum job que aplicasse isso de verdade. applyTacitAcceptance (chamada pelo job
// diário em lib/aceiteTacito.ts) fecha essa lacuna.

beforeAll(async () => {
  await seedIfEmpty();
});

function unique(prefix = '') {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function register(role: 'cedente' | 'sacado', companyName: string) {
  const email = `${unique()}-${role}@example.com`;
  const res = await request(app).post('/api/auth/register').send({ nome: 'Teste', email, password: 'senha123', companyName, role });
  return res.body.token as string;
}

async function emitirParaSacado(cedenteToken: string, sacadoCompany: string) {
  let duplicataId = '';
  for (let attempt = 0; attempt < 8 && !duplicataId; attempt++) {
    const res = await request(app)
      .post('/api/emitir/submit')
      .set('Authorization', `Bearer ${cedenteToken}`)
      .send({ sacado: sacadoCompany, cnpj: '33.222.111/0001-55', valor: '18.000', vencimento: '2026-12-31', seguro: false, nfAnexada: true, batchValores: [] });
    if (res.status === 200) duplicataId = res.body.duplicataId;
  }
  expect(duplicataId).toBeTruthy();
  return duplicataId;
}

function vencerPrazo(duplicataId: string) {
  db.prepare("UPDATE aceites SET prazo_limite = datetime('now', '-1 day') WHERE duplicata_id = ?").run(duplicataId);
}

describe('applyTacitAcceptance — aceite tácito real quando o prazo vence sem manifestação', () => {
  it('transiciona aguardando → aceita quando o prazo já venceu, e notifica o cedente', async () => {
    const sacadoCompany = unique('Sacado Tacito');
    const cedenteToken = await register('cedente', unique('Cedente Tacito'));
    const sacadoToken = await register('sacado', sacadoCompany);
    const duplicataId = await emitirParaSacado(cedenteToken, sacadoCompany);
    vencerPrazo(duplicataId);

    const aplicados = applyTacitAcceptance();
    expect(aplicados).toBeGreaterThan(0);

    const aceites = await request(app).get('/api/aceites').set('Authorization', `Bearer ${sacadoToken}`);
    const item = aceites.body.aceites.find((a: { duplicataId: string }) => a.duplicataId === duplicataId);
    expect(item.status).toBe('aceita');

    const notificacoesCedente = await request(app).get('/api/notifications').set('Authorization', `Bearer ${cedenteToken}`);
    expect(notificacoesCedente.body.notifications.some((n: { text: string }) => n.text.includes(duplicataId) && n.text.includes('aceitou'))).toBe(true);
  });

  it('não toca um aceite que ainda está dentro do prazo', async () => {
    const sacadoCompany = unique('Sacado Dentro Prazo');
    const cedenteToken = await register('cedente', unique('Cedente Dentro Prazo'));
    await register('sacado', sacadoCompany);
    const duplicataId = await emitirParaSacado(cedenteToken, sacadoCompany);
    // Prazo normal (ensureAceite já cria com +15 dias) — não mexe aqui.

    applyTacitAcceptance();

    const row = db.prepare('SELECT status FROM aceites WHERE duplicata_id = ?').get(duplicataId) as { status: string };
    expect(row.status).toBe('aguardando');
  });

  it('não toca um aceite já contestado ou já aceito, mesmo com prazo vencido', async () => {
    const sacadoCompanyContestada = unique('Sacado Ja Contestou');
    const cedenteToken = await register('cedente', unique('Cedente Ja Decidiu'));
    const sacadoTokenContestada = await register('sacado', sacadoCompanyContestada);
    const duplicataIdContestada = await emitirParaSacado(cedenteToken, sacadoCompanyContestada);

    const aceites = await request(app).get('/api/aceites').set('Authorization', `Bearer ${sacadoTokenContestada}`);
    const item = aceites.body.aceites.find((a: { duplicataId: string }) => a.duplicataId === duplicataIdContestada);
    await request(app).post(`/api/aceites/${item.id}/status`).set('Authorization', `Bearer ${sacadoTokenContestada}`).send({ status: 'contestada' });
    vencerPrazo(duplicataIdContestada);

    applyTacitAcceptance();

    const row = db.prepare('SELECT status FROM aceites WHERE duplicata_id = ?').get(duplicataIdContestada) as { status: string };
    expect(row.status).toBe('contestada'); // aceite tácito nunca sobrescreve uma decisão real já tomada
  });

  it('é idempotente — rodar duas vezes seguidas só notifica uma vez', async () => {
    const sacadoCompany = unique('Sacado Idempotente');
    const cedenteToken = await register('cedente', unique('Cedente Idempotente'));
    await register('sacado', sacadoCompany);
    const duplicataId = await emitirParaSacado(cedenteToken, sacadoCompany);
    vencerPrazo(duplicataId);

    const primeira = applyTacitAcceptance();
    expect(primeira).toBeGreaterThan(0);
    const segunda = applyTacitAcceptance();
    expect(segunda).toBe(0); // já está 'aceita', não é mais 'aguardando' — nada pra aplicar de novo
  });
});
