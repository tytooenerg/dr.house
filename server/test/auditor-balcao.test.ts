import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { getAceiteByDuplicata, setAceiteStatus } from '../src/db/aceites.js';
import { arrematar } from './helpers/auction.js';
import { credenciarInvestidor } from './helpers/investidor.js';

// O balcão é a única negociação da plataforma que acontece FORA de um livro público: preço e
// contraparte combinados diretamente entre duas mesas. Era exatamente o que o auditor não
// enxergava — e o que mais precisa ser auditável.
//
// A privacidade do OTC não é contrariada aqui. O sigilo é contra os outros PARTICIPANTES do
// mercado; o auditor não participa dele, é supervisão somente-leitura, e já enxerga disputas,
// fila de compliance e a trilha inteira.

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function adminToken() {
  const res = await request(app).post('/api/auth/login').send({ email: 'admin@lastro.demo', password: 'demo1234' });
  return res.body.token as string;
}

async function auditorToken() {
  const admin = await adminToken();
  const email = `auditor-balcao-${unique()}@example.com`;
  const criado = await request(app)
    .post('/api/admin/auditores')
    .set('Authorization', `Bearer ${admin}`)
    .send({ nome: 'Auditor Balcão', email, password: 'senhaforte123' });
  expect(criado.status).toBe(201);
  const login = await request(app).post('/api/auth/login').send({ email, password: 'senhaforte123' });
  return login.body.token as string;
}

async function investidor(nome: string) {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Mesa', email: `inv-aud-${unique()}@example.com`, password: 'senha123', companyName: `${nome} ${unique()}`, role: 'investidor' });
  credenciarInvestidor(res.body.user.id);
  return { token: res.body.token as string, userId: res.body.user.id as number, empresa: res.body.user.companyName as string };
}

/** Emite uma duplicata e faz `dono` arrematá-la, devolvendo a posição já formada. */
async function posicaoDe(dono: { token: string }, valor = '30.000') {
  const ced = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Cedente', email: `ced-aud-${unique()}@example.com`, password: 'senha123', companyName: `Cedente Aud ${unique()}`, role: 'cedente' });

  let duplicataId = '';
  for (let i = 0; i < 8 && !duplicataId; i++) {
    const res = await request(app)
      .post('/api/emitir/submit')
      .set('Authorization', `Bearer ${ced.body.token}`)
      .send({ sacado: `Sacado Aud ${unique()}`, cnpj: '55.444.333/0001-22', valor, vencimento: '2027-12-31', seguro: false, nfAnexada: true });
    if (res.status === 200) duplicataId = res.body.duplicataId;
  }
  expect(duplicataId).toBeTruthy();
  setAceiteStatus(getAceiteByDuplicata(duplicataId)!.id, 'aceita');
  expect((await arrematar(dono.token, duplicataId)).lance.status).toBe(200);
  return duplicataId;
}

const overview = (token: string) => request(app).get('/api/auditor/overview').set('Authorization', `Bearer ${token}`);

describe('o auditor enxerga o balcão', () => {
  it('vê uma negociação aberta com as duas partes nomeadas, o valor negociado e o de face', async () => {
    const vendedora = await investidor('Mesa Vendedora Aud');
    const compradora = await investidor('Mesa Compradora Aud');
    const duplicataId = await posicaoDe(vendedora, '40.000');

    const aberta = await request(app)
      .post('/api/secundario/otc')
      .set('Authorization', `Bearer ${compradora.token}`)
      .send({ duplicataId, valor: '31.000' });
    expect(aberta.status).toBe(200);

    const res = await overview(await auditorToken());
    expect(res.status).toBe(200);
    const linha = res.body.otc.recentes.find((n: { duplicataId: string }) => n.duplicataId === duplicataId);
    expect(linha).toBeTruthy();
    expect(linha.vendedor).toBe(vendedora.empresa);
    expect(linha.comprador).toBe(compradora.empresa);
    expect(linha.status).toBe('aberta');
    // O par negociado/face é o que denuncia um preço fora de mercado — é o motivo de a
    // linha trazer os dois em vez de só o valor da proposta.
    expect(linha.valorFmt).toContain('31.000');
    expect(linha.valorFaceFmt).toContain('40.000');
    // A proposta de abertura já é a primeira rodada.
    expect(linha.rodadas).toBe(1);
  });

  it('conta as rodadas de barganha — um acerto de uma tacada só não parece uma negociação disputada', async () => {
    const vendedora = await investidor('Mesa Vendedora Rodadas');
    const compradora = await investidor('Mesa Compradora Rodadas');
    const duplicataId = await posicaoDe(vendedora);

    const aberta = await request(app).post('/api/secundario/otc').set('Authorization', `Bearer ${compradora.token}`).send({ duplicataId, valor: '20.000' });
    const negociacaoId = aberta.body.negociacaoId as number;
    await request(app).post(`/api/secundario/otc/${negociacaoId}/contraproposta`).set('Authorization', `Bearer ${vendedora.token}`).send({ valor: '26.000' });
    await request(app).post(`/api/secundario/otc/${negociacaoId}/contraproposta`).set('Authorization', `Bearer ${compradora.token}`).send({ valor: '23.000' });

    const res = await overview(await auditorToken());
    const linha = res.body.otc.recentes.find((n: { id: number }) => n.id === negociacaoId);
    expect(linha.rodadas).toBe(3);
    // O valor mostrado é o que está EM CIMA DA MESA agora, não o da abertura.
    expect(linha.valorFmt).toContain('23.000');
  });

  it('separa liquidadas de encerradas, e soma o volume do que de fato mudou de mãos', async () => {
    const vendedora = await investidor('Mesa Vendedora Volume');
    const compradora = await investidor('Mesa Compradora Volume');

    const dupAceita = await posicaoDe(vendedora);
    const aceita = await request(app).post('/api/secundario/otc').set('Authorization', `Bearer ${compradora.token}`).send({ duplicataId: dupAceita, valor: '22.000' });
    expect((await request(app).post(`/api/secundario/otc/${aceita.body.negociacaoId}/aceitar`).set('Authorization', `Bearer ${vendedora.token}`).send({})).status).toBe(200);

    const dupRecusada = await posicaoDe(vendedora);
    const recusada = await request(app).post('/api/secundario/otc').set('Authorization', `Bearer ${compradora.token}`).send({ duplicataId: dupRecusada, valor: '19.000' });
    expect((await request(app).post(`/api/secundario/otc/${recusada.body.negociacaoId}/encerrar`).set('Authorization', `Bearer ${vendedora.token}`).send({})).status).toBe(200);

    const res = await overview(await auditorToken());
    const porId = (id: number) => res.body.otc.recentes.find((n: { id: number }) => n.id === id);
    expect(porId(aceita.body.negociacaoId).status).toBe('aceita');
    expect(porId(recusada.body.negociacaoId).status).toBe('recusada');
    // Uma recusada nunca entra no volume: não liquidou nada.
    expect(res.body.otc.aceitas).toBeGreaterThan(0);
    expect(res.body.otc.encerradas).toBeGreaterThan(0);
    expect(typeof res.body.otc.volumeAceitoFmt).toBe('string');
    expect(res.body.otc.volumeAceitoFmt.startsWith('R$')).toBe(true);
  });

  it('segue somente-leitura: o auditor vê a negociação e não consegue agir sobre ela', async () => {
    const vendedora = await investidor('Mesa Vendedora RO');
    const compradora = await investidor('Mesa Compradora RO');
    const duplicataId = await posicaoDe(vendedora);
    const aberta = await request(app).post('/api/secundario/otc').set('Authorization', `Bearer ${compradora.token}`).send({ duplicataId, valor: '21.000' });
    const negociacaoId = aberta.body.negociacaoId as number;

    const token = await auditorToken();
    expect((await overview(token)).body.otc.recentes.some((n: { id: number }) => n.id === negociacaoId)).toBe(true);

    // Enxergar não é poder mexer. O papel de auditor não passa nem pelo gate de investidor.
    for (const rota of [`/api/secundario/otc/${negociacaoId}/aceitar`, `/api/secundario/otc/${negociacaoId}/encerrar`]) {
      const res = await request(app).post(rota).set('Authorization', `Bearer ${token}`).send({});
      expect(res.status).toBeGreaterThanOrEqual(400);
    }
    const abrir = await request(app).post('/api/secundario/otc').set('Authorization', `Bearer ${token}`).send({ duplicataId, valor: '25.000' });
    expect(abrir.status).toBeGreaterThanOrEqual(400);
  });
});

describe('as disputas que o servidor já servia agora chegam ao painel', () => {
  it('o overview traz o bloco de disputas com contagem e lista — o campo existia e a tela não o declarava', async () => {
    const res = await overview(await auditorToken());
    expect(res.status).toBe(200);
    expect(typeof res.body.disputas.abertas).toBe('number');
    expect(typeof res.body.disputas.resolvidas).toBe('number');
    expect(Array.isArray(res.body.disputas.recentes)).toBe(true);
  });
});
