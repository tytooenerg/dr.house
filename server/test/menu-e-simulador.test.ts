import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { vencimentoFuturo } from './helpers/datas.js';

// Etapa 4 de "facilitar a vida da empresa": menu essencial (só muda a exibição) e o simulador
// público mostrando quanto a empresa RECEBE, não só a taxa.

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

describe('menu essencial da empresa', () => {
  it('começa no modo essencial e alterna para o completo sem mudar as permissões', async () => {
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ nome: 'Menu', email: `menu-${unique()}@example.com`, password: 'senha123', companyName: `Loja ${unique()} Ltda`, role: 'cedente' });
    expect(reg.body.user.menuCompleto).toBe(false);
    const abasAntes = reg.body.user.navTabs;

    const res = await request(app).post('/api/auth/menu').set('Authorization', `Bearer ${reg.body.token}`).send({ completo: true });
    expect(res.status).toBe(200);
    expect(res.body.user.menuCompleto).toBe(true);
    expect(res.body.user.navTabs).toEqual(abasAntes);
    expect((await request(app).post('/api/auth/menu').set('Authorization', `Bearer ${reg.body.token}`).send({ completo: 'sim' })).status).toBe(400);
  });
});

describe('simulador público', () => {
  it('com valor e vencimento, devolve a conta completa com o que a empresa recebe', async () => {
    const res = await request(app).post('/api/public/simular').send({ valor: '50.000', vencimento: vencimentoFuturo(60) });
    expect(res.status).toBe(200);
    const d = res.body.demonstrativo;
    expect(d.valorFace).toBe(50000);
    expect(d.linhas.map((l: { rotulo: string }) => l.rotulo)).toEqual(['Valor da duplicata', 'Deságio do banco/fundo', 'Banco/fundo paga hoje', 'Taxa da plataforma Lastro', 'Empresa recebe']);
    expect(d.vendedorRecebe).toBeCloseTo(d.compradorPaga - 50000 * 0.0035, 6);
  });

  it('sem vencimento, não inventa conta', async () => {
    const res = await request(app).post('/api/public/simular').send({ valor: '50.000' });
    expect(res.status).toBe(200);
    expect(res.body.demonstrativo).toBeNull();
  });
});
