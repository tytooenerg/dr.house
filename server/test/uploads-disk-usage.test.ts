import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { db } from '../src/db/index.js';
import { uploadDir } from '../src/routes/uploads.js';

// Achado numa revisão de produção: nenhum upload (comprovantes, contratos, documentos de
// KYB) jamais é apagado — um risco real de disco cheio sem nenhuma visibilidade antes de
// algo já ter quebrado. lib/uploadsDiskUsage.ts só soma o que já existe (não apaga nada);
// isto testa que a soma é real (bytes de verdade em disco, não um número inventado) e que
// um registro cujo arquivo física foi removido do disco não quebra o cálculo.

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

async function registerAndLogin() {
  const email = `disk-usage-${unique()}@example.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Disk Usage Tester', email, password: 'senha123', companyName: `Empresa ${unique()}`, role: 'cedente' });
  return res.body.token as string;
}

describe('GET /admin/uploads/disk-usage', () => {
  it('soma bytes reais de arquivos realmente enviados, agrupados por kind', async () => {
    const before = await request(app).get('/api/admin/uploads/disk-usage').set('Authorization', `Bearer ${await loginAdmin()}`);
    expect(before.status).toBe(200);
    const totalBytesAntes = before.body.totalBytes as number;

    const token = await registerAndLogin();
    await request(app)
      .post('/api/uploads')
      .set('Authorization', `Bearer ${token}`)
      .field('kind', 'disk_usage_test_kind')
      .attach('file', MINIMAL_PDF, { filename: 'teste-disco.pdf', contentType: 'application/pdf' });

    const after = await request(app).get('/api/admin/uploads/disk-usage').set('Authorization', `Bearer ${await loginAdmin()}`);
    expect(after.status).toBe(200);
    expect(after.body.totalBytes).toBe(totalBytesAntes + MINIMAL_PDF.length);

    const kindEntry = (after.body.byKind as { kind: string; count: number; bytes: number }[]).find((k) => k.kind === 'disk_usage_test_kind');
    expect(kindEntry).toBeTruthy();
    expect(kindEntry!.count).toBe(1);
    expect(kindEntry!.bytes).toBe(MINIMAL_PDF.length);
  });

  it('um upload registrado no banco cujo arquivo foi removido do disco conta como "missing", sem quebrar o cálculo', async () => {
    const token = await registerAndLogin();
    const upload = await request(app)
      .post('/api/uploads')
      .set('Authorization', `Bearer ${token}`)
      .field('kind', 'disk_usage_missing_test')
      .attach('file', MINIMAL_PDF, { filename: 'vai-desaparecer.pdf', contentType: 'application/pdf' });
    expect(upload.status).toBe(201);

    const row = db.prepare('SELECT path FROM uploads WHERE id = ?').get(upload.body.upload.id) as { path: string };
    fs.unlinkSync(path.join(uploadDir, row.path));

    const res = await request(app).get('/api/admin/uploads/disk-usage').set('Authorization', `Bearer ${await loginAdmin()}`);
    expect(res.status).toBe(200);
    expect(res.body.missingCount).toBeGreaterThanOrEqual(1);
    expect(res.body.byKind.find((k: { kind: string }) => k.kind === 'disk_usage_missing_test')).toBeUndefined();
  });

  it('é restrito a admin', async () => {
    const token = await registerAndLogin();
    const res = await request(app).get('/api/admin/uploads/disk-usage').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});
