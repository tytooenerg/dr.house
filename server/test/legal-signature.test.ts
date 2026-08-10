import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { recordLegalDocument, getLegalDocument } from '../src/db/legalDocuments.js';

beforeAll(async () => {
  await seedIfEmpty();
});

async function adminToken() {
  const res = await request(app).post('/api/auth/login').send({ email: 'admin@lastro.demo', password: 'demo1234' });
  return res.body.token as string;
}

function makeDoc() {
  return recordLegalDocument({ type: 'notificacao_padrao', content: 'Conteúdo de teste da minuta.' });
}

describe('E-signature (real-when-configured — ESIGNATURE_API_URL/KEY unset in tests, so every send is simulated)', () => {
  it('refuses to send an unreviewed document for signature', async () => {
    const admin = await adminToken();
    const doc = makeDoc();
    const res = await request(app)
      .post(`/api/admin/juridico/documentos/${doc.id}/assinatura`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ signerName: 'Fulano de Tal', signerEmail: 'fulano@example.com' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('not_reviewed');
  });

  it('sends a reviewed document for signature (simulated) and reports it as unconfigured, not fake-real', async () => {
    const admin = await adminToken();
    const doc = makeDoc();
    await request(app).post(`/api/admin/juridico/documentos/${doc.id}/revisar`).set('Authorization', `Bearer ${admin}`);

    const res = await request(app)
      .post(`/api/admin/juridico/documentos/${doc.id}/assinatura`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ signerName: 'Fulano de Tal', signerEmail: 'fulano@example.com' });
    expect(res.status).toBe(200);
    expect(res.body.simulado).toBe(true);
    expect(res.body.esignatureConfigured).toBe(false);
    expect(res.body.envelopeId).toBeTruthy();

    const stored = getLegalDocument(doc.id)!;
    expect(stored.signature_status).toBe('enviado');
    expect(stored.signer_name).toBe('Fulano de Tal');
    expect(stored.signer_email).toBe('fulano@example.com');
    expect(stored.signature_envelope_id).toBeTruthy();
  });

  it('rejects sending the same document for signature twice', async () => {
    const admin = await adminToken();
    const doc = makeDoc();
    await request(app).post(`/api/admin/juridico/documentos/${doc.id}/revisar`).set('Authorization', `Bearer ${admin}`);
    await request(app)
      .post(`/api/admin/juridico/documentos/${doc.id}/assinatura`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ signerName: 'Signatario A', signerEmail: 'a@example.com' });

    const again = await request(app)
      .post(`/api/admin/juridico/documentos/${doc.id}/assinatura`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ signerName: 'Signatario B', signerEmail: 'b@example.com' });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('already_sent');
  });

  it('checks and updates the signature status (simulated mode resolves to assinado)', async () => {
    const admin = await adminToken();
    const doc = makeDoc();
    await request(app).post(`/api/admin/juridico/documentos/${doc.id}/revisar`).set('Authorization', `Bearer ${admin}`);
    await request(app)
      .post(`/api/admin/juridico/documentos/${doc.id}/assinatura`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ signerName: 'Fulano', signerEmail: 'fulano@example.com' });

    const status = await request(app).post(`/api/admin/juridico/documentos/${doc.id}/assinatura/status`).set('Authorization', `Bearer ${admin}`);
    expect(status.status).toBe(200);
    expect(status.body.signatureStatus).toBe('assinado');

    const stored = getLegalDocument(doc.id)!;
    expect(stored.signature_status).toBe('assinado');
    expect(stored.signature_signed_at).toBeTruthy();
  });

  it('rejects a status check for a document never sent for signature', async () => {
    const admin = await adminToken();
    const doc = makeDoc();
    const res = await request(app).post(`/api/admin/juridico/documentos/${doc.id}/assinatura/status`).set('Authorization', `Bearer ${admin}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('not_sent');
  });

  it('validates signer name/email on send', async () => {
    const admin = await adminToken();
    const doc = makeDoc();
    await request(app).post(`/api/admin/juridico/documentos/${doc.id}/revisar`).set('Authorization', `Bearer ${admin}`);
    const res = await request(app)
      .post(`/api/admin/juridico/documentos/${doc.id}/assinatura`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ signerName: '', signerEmail: 'not-an-email' });
    expect(res.status).toBe(400);
  });
});
