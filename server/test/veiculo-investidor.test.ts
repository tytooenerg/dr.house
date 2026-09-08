import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { approveKyb, setVeiculo, getUserById, backfillInvestorVeiculo, updateKybForm } from '../src/db/users.js';
import { db } from '../src/db/index.js';
import { credenciarInvestidor } from './helpers/investidor.js';
import { darLance, garantirLeilao } from './helpers/auction.js';

// Comprar direito creditório no Brasil não é atividade livre: é factoring, FIDC, fundo ou
// instituição financeira, cada um com regime jurídico e tributário próprio. Até a migração
// 0070 a plataforma não sabia sob qual veículo cada compra acontecia — havia um `tipo` no KYB
// lido só pela triagem de estrangeiro, decorativo no caminho doméstico.

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function registrarInvestidor() {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Investidor', email: `inv-veic-${unique()}@example.com`, password: 'senha123', companyName: `Fundo ${unique()}`, role: 'investidor' });
  return { token: res.body.token as string, userId: res.body.user.id as number };
}

async function registrarAdmin() {
  const res = await request(app).post('/api/auth/login').send({ email: 'admin@lastro.demo', password: 'demo1234' });
  return res.body.token as string;
}

describe('veículo do investidor — o gate', () => {
  it('investidor com KYB aprovado mas sem veículo classificado não dá lance', async () => {
    const inv = await registrarInvestidor();
    approveKyb(inv.userId); // aprovado, mas sem dizer sob qual veículo compra

    const market = await request(app).get('/api/market').set('Authorization', `Bearer ${inv.token}`);
    const oferta = market.body.offers.find((o: { canBuy: boolean }) => o.canBuy);
    garantirLeilao(oferta.id);

    const res = await darLance(inv.token, oferta.id);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('veiculo_required');
    expect(res.body.message).toContain('veículo');
  });

  it('classificado, o mesmo investidor passa a dar lance', async () => {
    const inv = await registrarInvestidor();
    approveKyb(inv.userId);
    const market = await request(app).get('/api/market').set('Authorization', `Bearer ${inv.token}`);
    const oferta = market.body.offers.find((o: { canBuy: boolean }) => o.canBuy);

    expect((await darLance(inv.token, oferta.id)).status).toBe(403);
    setVeiculo(inv.userId, 'factoring');
    expect((await darLance(inv.token, oferta.id)).status).toBe(200);
  });

  it('um veículo inventado não vale — só as quatro chaves do catálogo', async () => {
    const inv = await registrarInvestidor();
    credenciarInvestidor(inv.userId);
    setVeiculo(inv.userId, 'sociedade_secreta');

    const market = await request(app).get('/api/market').set('Authorization', `Bearer ${inv.token}`);
    const oferta = market.body.offers.find((o: { canBuy: boolean }) => o.canBuy);
    const res = await darLance(inv.token, oferta.id);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('veiculo_required');
  });
});

describe('veículo do investidor — a aprovação do admin', () => {
  it('o admin não aprova investidor sem veículo, e a conta não fica meio-aprovada', async () => {
    const inv = await registrarInvestidor();
    await request(app).post('/api/auth/kyb').set('Authorization', `Bearer ${inv.token}`).send({ cnpj: '11.222.333/0001-44', pl: '1.000.000' });
    const admin = await registrarAdmin();

    const res = await request(app).post(`/api/admin/kyb/${inv.userId}/approve`).set('Authorization', `Bearer ${admin}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('veiculo_required');
    // Recusar aqui só vale se a conta REALMENTE não tiver sido aprovada por baixo.
    expect(getUserById(inv.userId)!.kyb_status).not.toBe('approved');
  });

  it('com o veículo informado no KYB, a aprovação passa e o campo fica gravado', async () => {
    const inv = await registrarInvestidor();
    await request(app)
      .post('/api/auth/kyb')
      .set('Authorization', `Bearer ${inv.token}`)
      .send({ cnpj: '11.222.333/0001-44', tipo: 'fidc', pl: '1.000.000' });
    expect(getUserById(inv.userId)!.veiculo).toBe('fidc');

    const admin = await registrarAdmin();
    const res = await request(app).post(`/api/admin/kyb/${inv.userId}/approve`).set('Authorization', `Bearer ${admin}`);
    expect(res.status).toBe(200);
    expect(getUserById(inv.userId)!.kyb_status).toBe('approved');
  });

  it('cedente não é barrado pelo gate de veículo — a regra é de quem adquire crédito', async () => {
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ nome: 'Cedente', email: `ced-veic-${unique()}@example.com`, password: 'senha123', companyName: 'Cedente Ltda', role: 'cedente' });
    const admin = await registrarAdmin();
    const res = await request(app).post(`/api/admin/kyb/${reg.body.user.id}/approve`).set('Authorization', `Bearer ${admin}`);
    expect(res.status).toBe(200);
  });
});

describe('veículo do investidor — backfill do KYB antigo', () => {
  it('mapeia só os dois casos inequívocos e deixa os ambíguos para reclassificação', async () => {
    const banco = await registrarInvestidor();
    const fidc = await registrarInvestidor();
    const fintech = await registrarInvestidor();
    updateKybForm(banco.userId, 'tipo', 'Banco comercial');
    updateKybForm(fidc.userId, 'tipo', 'Fundo (FIDC)');
    updateKybForm(fintech.userId, 'tipo', 'Fintech de crédito');
    for (const u of [banco, fidc, fintech]) db.prepare("UPDATE users SET veiculo = 'nao_informado' WHERE id = ?").run(u.userId);

    backfillInvestorVeiculo();

    expect(getUserById(banco.userId)!.veiculo).toBe('banco');
    expect(getUserById(fidc.userId)!.veiculo).toBe('fidc');
    // 'Fintech de crédito' pode ser SCD, SEP ou nenhuma das duas — classificação jurídica
    // errada é pior que ausente, então essa fica pedindo reclassificação explícita.
    expect(getUserById(fintech.userId)!.veiculo).toBe('nao_informado');
  });

  it('é idempotente e nunca sobrescreve quem já está classificado', async () => {
    const inv = await registrarInvestidor();
    updateKybForm(inv.userId, 'tipo', 'Banco comercial');
    setVeiculo(inv.userId, 'factoring'); // reclassificado à mão depois

    backfillInvestorVeiculo();
    expect(getUserById(inv.userId)!.veiculo).toBe('factoring');
    expect(backfillInvestorVeiculo()).toBe(0);
  });
});

describe('veículo do investidor — o cedente vê quem financia', () => {
  it('cada lance do leilão mostra sob qual veículo aquele investidor compraria', async () => {
    const inv = await registrarInvestidor();
    credenciarInvestidor(inv.userId, 'fidc');
    const market = await request(app).get('/api/market').set('Authorization', `Bearer ${inv.token}`);
    const oferta = market.body.offers.find((o: { canBuy: boolean }) => o.canBuy);
    expect((await darLance(inv.token, oferta.id)).status).toBe(200);

    const depois = await request(app).get('/api/market').set('Authorization', `Bearer ${inv.token}`);
    const comLance = depois.body.offers.find((o: { id: string }) => o.id === oferta.id);
    // Pelo próprio lance (isMine), e não por bids[0]: a oferta acumula lances de outros
    // testes deste arquivo, e o melhor lance pode não ser o deste investidor.
    const meu = comLance.bids.find((b: { isMine: boolean }) => b.isMine);
    expect(meu.veiculo).toBe('FIDC');
  });
});
