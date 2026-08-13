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

async function registerAndLogin() {
  const email = `upload-${unique()}@example.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Upload Tester', email, password: 'senha123', companyName: `Empresa ${unique()}`, role: 'cedente' });
  return res.body.token as string;
}

// A minimal, syntactically valid PDF — small enough to keep the test fast, real enough that
// multer's own parsing (not just the MIME-type header) has something to chew on.
const MINIMAL_PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');

describe('file uploads (POST /api/uploads)', () => {
  it('requires auth', async () => {
    const res = await request(app).post('/api/uploads').attach('file', MINIMAL_PDF, 'doc.pdf');
    expect(res.status).toBe(401);
  });

  it('rejects a request with no file attached', async () => {
    const token = await registerAndLogin();
    const res = await request(app).post('/api/uploads').set('Authorization', `Bearer ${token}`).field('kind', 'kyb_doc');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('no_file');
  });

  it('rejects an unsupported MIME type before ever touching disk', async () => {
    const token = await registerAndLogin();
    const res = await request(app)
      .post('/api/uploads')
      .set('Authorization', `Bearer ${token}`)
      .field('kind', 'outro')
      .attach('file', Buffer.from('#!/bin/sh\necho hi'), { filename: 'script.sh', contentType: 'application/x-sh' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('upload_error');
  });

  it('accepts a plain document upload and records it', async () => {
    const token = await registerAndLogin();
    const res = await request(app)
      .post('/api/uploads')
      .set('Authorization', `Bearer ${token}`)
      .field('kind', 'outro')
      .attach('file', MINIMAL_PDF, { filename: 'doc.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(201);
    expect(res.body.upload.kind).toBe('outro');
    expect(res.body.upload.filename).toBe('doc.pdf');
    expect(res.body.extracted).toBeNull();
    expect(res.body.analysis).toBeNull();
    expect(res.body.biometria).toBeNull();
  });

  it('a kyb_doc upload marks KYB as done', async () => {
    const token = await registerAndLogin();
    const before = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(before.body.user.kybDone).toBe(false);

    const res = await request(app)
      .post('/api/uploads')
      .set('Authorization', `Bearer ${token}`)
      .field('kind', 'kyb_doc')
      .attach('file', MINIMAL_PDF, { filename: 'contrato-social.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(201);

    const after = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(after.body.user.kybDone).toBe(true);
  });

  it('an nfe upload with ANTHROPIC_API_KEY unconfigured stores the upload and honestly returns extracted: null instead of a fabricated guess', async () => {
    const token = await registerAndLogin();
    const res = await request(app)
      .post('/api/uploads')
      .set('Authorization', `Bearer ${token}`)
      .field('kind', 'nfe')
      .attach('file', MINIMAL_PDF, { filename: 'nfe.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(201);
    expect(res.body.upload.kind).toBe('nfe');
    expect(res.body.extracted).toBeNull();
  });

  it('a contrato_cessao upload with ANTHROPIC_API_KEY unconfigured returns analysis: null and records nothing to review', async () => {
    const token = await registerAndLogin();
    const res = await request(app)
      .post('/api/uploads')
      .set('Authorization', `Bearer ${token}`)
      .field('kind', 'contrato_cessao')
      .attach('file', MINIMAL_PDF, { filename: 'contrato.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(201);
    expect(res.body.analysis).toBeNull();
  });

  it('a selfie_liveness upload with BIOMETRIC_KYC_API_URL unconfigured returns biometria: null rather than a fabricated pass', async () => {
    const token = await registerAndLogin();
    const res = await request(app)
      .post('/api/uploads')
      .set('Authorization', `Bearer ${token}`)
      .field('kind', 'selfie_liveness')
      .attach('file', Buffer.from([0xff, 0xd8, 0xff, 0xdb]), { filename: 'selfie.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(201);
    expect(res.body.biometria).toBeNull();
  });
});
