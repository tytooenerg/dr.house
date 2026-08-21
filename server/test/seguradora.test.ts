import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';

beforeAll(async () => {
  await seedIfEmpty();
});

async function loginSeguradora() {
  const res = await request(app).post('/api/auth/login').send({ email: 'seguradora@lastro.demo', password: 'demo1234' });
  return res.body.token as string;
}

describe('seguradora role', () => {
  it('is forbidden for non-seguradora roles', async () => {
    const login = await request(app).post('/api/auth/login').send({ email: 'investidor@lastro.demo', password: 'demo1234' });
    const res = await request(app).get('/api/seguradora').set('Authorization', `Bearer ${login.body.token}`);
    expect(res.status).toBe(403);
  });

  it('requires selecting an insurer when registering as seguradora', async () => {
    const email = `seg-${Date.now()}@example.com`;
    const res = await request(app)
      .post('/api/auth/register')
      .send({ nome: 'Nova Seguradora', email, password: 'senha123', companyName: 'Nova Seguros', role: 'seguradora' });
    expect(res.status).toBe(400);
  });

  it('shows the demo seguradora dashboard with seeded policies and an open sinistro', async () => {
    const token = await loginSeguradora();
    const res = await request(app).get('/api/seguradora').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.insurerName).toBe('Too Seguros');
    expect(res.body.totalApolices).toBeGreaterThan(0);
    expect(res.body.sinistros.length).toBeGreaterThan(0);
  });

  it('lets the seguradora approve a sinistro, notifying the cedente', async () => {
    const token = await loginSeguradora();
    const before = await request(app).get('/api/seguradora').set('Authorization', `Bearer ${token}`);
    const sinistro = before.body.sinistros[0];
    expect(sinistro).toBeTruthy();

    const res = await request(app)
      .post(`/api/seguradora/sinistro/${sinistro.id}/decidir`)
      .set('Authorization', `Bearer ${token}`)
      .send({ decision: 'aprovado', note: 'Documentação conferida, indenização aprovada.' });
    expect(res.status).toBe(200);
    expect(res.body.sinistros.some((s: { id: string }) => s.id === sinistro.id)).toBe(false);

    const apolice = res.body.apolices.find((a: { id: string }) => a.id === sinistro.id);
    expect(apolice.sinistroStatus).toBe('aprovado');

    // deciding the same sinistro again should 404 (already decided)
    const again = await request(app)
      .post(`/api/seguradora/sinistro/${sinistro.id}/decidir`)
      .set('Authorization', `Bearer ${token}`)
      .send({ decision: 'negado', note: 'tentativa duplicada' });
    expect(again.status).toBe(404);
  });
});
