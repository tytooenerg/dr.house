import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { db } from '../src/db/index.js';
import { darLance } from './helpers/auction.js';
import { credenciarInvestidor } from './helpers/investidor.js';
import { vencimentoFuturo } from './helpers/datas.js';

// A disputa é o produto: vários financiadores competindo por uma duplicata, menor deságio
// ganha. Ela era desenhada em detalhe no card do MARKETPLACE — nome do financiador, veículo,
// taxa, "Melhor lance", contagem regressiva — para quem está competindo. O CEDENTE, dono da
// duplicata sendo disputada, recebia de GET /api/minhas apenas `status: 'No mercado'`: abria o
// leilão e esperava no escuro até fechar.
//
// O comentário do veículo em lib/marketCompute.ts afirmava o direito com todas as letras — "o
// cedente tem o direito de saber se quem está financiando é um banco, um FIDC, um fundo ou uma
// factoring" — e o cedente era exatamente o leitor que não recebia. Havia ainda um
// `viewAuctionBids` em lib/auctionCore.ts que montava essa escada e nunca foi chamado por
// ninguém: máquina pronta e desligada.

beforeAll(async () => {
  await seedIfEmpty();
});

const unico = (p: string) => `${p}-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 6)}`;

async function cedenteComDuplicataEmLeilao() {
  const email = `${unico('ced')}@example.com`;
  const reg = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Cedente', email, password: 'senha123', companyName: unico('Fornecedora'), role: 'cedente' });
  const token = reg.body.token as string;

  let emit = await request(app)
    .post('/api/emitir/submit')
    .set('Authorization', `Bearer ${token}`)
    .send({ sacado: unico('Sacado'), cnpj: '44.333.222/0001-11', valor: '40.000', vencimento: vencimentoFuturo(), seguro: false, nfAnexada: true, batchValores: [] });
  for (let i = 0; i < 5 && emit.status !== 200; i++) {
    emit = await request(app)
      .post('/api/emitir/submit')
      .set('Authorization', `Bearer ${token}`)
      .send({ sacado: unico('Sacado'), cnpj: '44.333.222/0001-11', valor: '40.000', vencimento: vencimentoFuturo(), seguro: false, nfAnexada: true, batchValores: [] });
  }
  expect(emit.status).toBe(200);
  const duplicataId = emit.body.duplicataId as string;
  // O aceite direto no banco é a convenção deste repositório pros testes cujo assunto não é o
  // fluxo de aceite (ver full-lifecycle-all-roles.test.ts); aqui o assunto é o leilão.
  db.prepare("UPDATE aceites SET status = 'aceita' WHERE duplicata_id = ?").run(duplicataId);
  return { token, duplicataId };
}

async function investidorCredenciado(nome: string) {
  const reg = await request(app)
    .post('/api/auth/register')
    .send({ nome, email: `${unico('inv')}@example.com`, password: 'senha123', companyName: nome, role: 'investidor' });
  credenciarInvestidor(reg.body.user.id);
  return reg.body.token as string;
}

async function minhas(token: string, duplicataId: string) {
  const res = await request(app).get('/api/minhas').set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  return res.body.duplicatas.find((d: { id: string }) => d.id === duplicataId);
}

describe('o cedente enxerga o leilão da própria duplicata', () => {
  it('a escada de lances chega ao dono: quantos, quem, sob qual veículo, e a que preço', async () => {
    const { token, duplicataId } = await cedenteComDuplicataEmLeilao();

    // Antes de qualquer lance: o leilão existe e está vazio — vazio é vazio, não é ausente.
    const a = await request(app).post(`/api/minhas/${duplicataId}/leilao`).set('Authorization', `Bearer ${token}`).send({ taxaMaxima: 3 });
    expect(a.status).toBe(200);
    const semLances = await minhas(token, duplicataId);
    expect(semLances.leilao).not.toBeNull();
    expect(semLances.leilao.totalLances).toBe(0);
    expect(semLances.leilao.melhorTaxaFmt).toBeNull();
    expect(semLances.leilao.fechaEmSec).toBeGreaterThan(0);

    const invA = await investidorCredenciado(unico('Fundo Aurora'));
    const invB = await investidorCredenciado(unico('Fundo Bandeirantes'));
    expect((await darLance(invA, duplicataId, 2.5)).status).toBe(200);
    expect((await darLance(invB, duplicataId, 1.9)).status).toBe(200);

    const comLances = await minhas(token, duplicataId);
    expect(comLances.leilao.totalLances).toBe(2);
    // Ordem de vitória: menor deságio primeiro, a mesma que lib/auctionClose.ts adjudica.
    expect(comLances.leilao.lances[0].taxaFmt).toBe('1,90%');
    expect(comLances.leilao.lances[0].isMelhor).toBe(true);
    expect(comLances.leilao.lances[1].taxaFmt).toBe('2,50%');
    expect(comLances.leilao.lances[1].isMelhor).toBe(false);
    expect(comLances.leilao.melhorTaxaFmt).toBe('1,90%');
    // O que a melhor taxa significa em dinheiro — a pergunta que o cedente faz de verdade.
    expect(comLances.leilao.melhorPrecoFmt).toMatch(/^R\$/);
    // O regime sob o qual o crédito seria adquirido, que era servido só a quem competia.
    expect(comLances.leilao.lances[0].veiculo).toBeTruthy();
    expect(comLances.leilao.lances[0].empresa).toBeTruthy();
  });

  it('nenhum cedente vê o leilão da duplicata de outro', async () => {
    const dono = await cedenteComDuplicataEmLeilao();
    await request(app).post(`/api/minhas/${dono.duplicataId}/leilao`).set('Authorization', `Bearer ${dono.token}`).send({ taxaMaxima: 3 });
    const inv = await investidorCredenciado(unico('Fundo Terceiro'));
    expect((await darLance(inv, dono.duplicataId, 2.2)).status).toBe(200);

    const outro = await cedenteComDuplicataEmLeilao();
    const listaDoOutro = await request(app).get('/api/minhas').set('Authorization', `Bearer ${outro.token}`);
    expect(listaDoOutro.status).toBe(200);
    expect(listaDoOutro.body.duplicatas.some((d: { id: string }) => d.id === dono.duplicataId)).toBe(false);
  });

  it('fora do leilão o bloco é null — e não um leilão vazio, que a tela desenharia como disputa', async () => {
    const { token, duplicataId } = await cedenteComDuplicataEmLeilao();
    const antes = await minhas(token, duplicataId);
    expect(antes.leilao).toBeNull();
    // A simulação, essa sim, existe desde antes de abrir: é ela que responde "quanto eu recebo".
    expect(antes.precoEstimadoFmt).toMatch(/^R\$/);
  });
});
