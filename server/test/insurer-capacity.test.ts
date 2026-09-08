import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { getDuplicata, setInsurer } from '../src/db/duplicatas.js';
import { setInsurerLimits, getInsurerLimits } from '../src/db/insurerLimits.js';
import { buildExposicao, cabeNaCapacidade, apoliceEmRisco } from '../src/lib/insurerExposure.js';
import { recordInsuranceSettlement } from '../src/db/insuranceSettlements.js';
import { buildSeguradoraPayload } from '../src/lib/seguradoraCore.js';
import { ensureAceite, setAceiteStatus } from '../src/db/aceites.js';
import { getUserByEmail } from '../src/db/users.js';
import { fmtBRL } from '../src/lib/format.js';

// A Lastro distribui as apólices, então é a única parte que enxerga o livro inteiro
// distribuído. Até aqui não enxergava: uma seguradora acumulava exposição ilimitada num
// mesmo sacado e seguia sendo oferecida como se tivesse capacidade infinita.

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function cedente() {
  const email = `ced-cap-${unique()}@example.com`;
  const reg = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Cedente Cap', email, password: 'senha123', companyName: `Cedente Cap ${unique()}`, role: 'cedente' });
  return { token: reg.body.token as string, id: reg.body.user.id as number };
}

async function emitir(token: string, valor: string, sacado = 'Grupo Atlas Varejo', cnpj = '58.442.111/0001-27') {
  for (let i = 0; i < 8; i++) {
    const res = await request(app)
      .post('/api/emitir/submit')
      .set('Authorization', `Bearer ${token}`)
      .send({ sacado, cnpj, valor, vencimento: '2027-12-31', seguro: false, nfAnexada: true });
    if (res.status === 200) return res.body.duplicataId as string;
  }
  throw new Error('não consegui emitir');
}

/** Segura uma duplicata direto no banco, com o prêmio realmente registrado. */
function segurar(duplicataId: string, insurerKey: string, premio: number, investorId = 1) {
  setInsurer(duplicataId, insurerKey);
  recordInsuranceSettlement({
    duplicataId,
    investorId,
    insurerKey,
    premio,
    comissaoLastro: premio * 0.18,
    repasseSeguradora: premio * 0.82,
  });
}

describe('exposição viva da seguradora', () => {
  it('conta só o risco que ainda pode virar sinistro, agrupado por sacado', async () => {
    const { token } = await cedente();
    const key = `cap-${unique()}`; // chave isolada, pra não somar com o resto da suíte
    const a = await emitir(token, '10.000', 'Grupo Atlas Varejo', '58.442.111/0001-27');
    const b = await emitir(token, '15.000', 'Grupo Atlas Varejo', '58.442.111/0001-27');
    const c = await emitir(token, '20.000', 'Distribuidora Bom Preço', '11.222.333/0001-44');
    for (const id of [a, b, c]) segurar(id, key, 100);

    const exp = buildExposicao(key);
    expect(exp.total).toBe(45000);
    expect(exp.apolices).toBe(3);
    // Concentração agrupa pelo CNPJ do sacado, e vem ordenada da maior pra menor.
    expect(exp.porSacado[0].sacado).toBe('Grupo Atlas Varejo');
    expect(exp.porSacado[0].valor).toBe(25000);
    expect(exp.porSacado[0].apolices).toBe(2);
    expect(exp.porSacado[1].valor).toBe(20000);
  });

  it('para de contar a apólice cujo risco deixou de existir', async () => {
    const { token } = await cedente();
    const key = `cap-${unique()}`;
    const id = await emitir(token, '30.000');
    segurar(id, key, 100);
    expect(buildExposicao(key).total).toBe(30000);

    // Vendida: o cedente recebeu, que é exatamente o risco que a apólice cobre.
    const { setStatus } = await import('../src/db/duplicatas.js');
    setStatus(id, 'vendida');
    expect(apoliceEmRisco(getDuplicata(id)!)).toBe(false);
    expect(buildExposicao(key).total).toBe(0);
  });
});

describe('capacidade declarada', () => {
  it('sem limite declarado, a plataforma não impõe teto nenhum', async () => {
    const { token } = await cedente();
    const key = `cap-${unique()}`;
    const grande = await emitir(token, '900.000');
    segurar(grande, key, 100);

    expect(getInsurerLimits(key)).toBeUndefined();
    const outra = await emitir(token, '900.000');
    // Sem declaração, cabe — a plataforma não inventa uma capacidade que ninguém informou.
    expect(cabeNaCapacidade(key, getDuplicata(outra)!).ok).toBe(true);
  });

  it('recusa quando o limite total declarado seria estourado', async () => {
    const { token } = await cedente();
    const key = `cap-${unique()}`;
    setInsurerLimits(key, 100_000, null);

    const primeira = await emitir(token, '80.000');
    expect(cabeNaCapacidade(key, getDuplicata(primeira)!).ok).toBe(true);
    segurar(primeira, key, 100);

    const segunda = await emitir(token, '30.000');
    const veredito = cabeNaCapacidade(key, getDuplicata(segunda)!);
    expect(veredito.ok).toBe(false);
    expect(veredito.motivo).toBe('limite_total');
    // A recusa diz o limite e o quanto já está em risco — sem isso ninguém sabe o que fazer.
    expect(veredito.message).toMatch(/100\.000/);

    // Uma que ainda cabe no que sobrou continua passando.
    const terceira = await emitir(token, '15.000');
    expect(cabeNaCapacidade(key, getDuplicata(terceira)!).ok).toBe(true);
  });

  it('recusa por concentração num sacado mesmo com folga no limite total', async () => {
    const { token } = await cedente();
    const key = `cap-${unique()}`;
    setInsurerLimits(key, 10_000_000, 50_000);

    const a = await emitir(token, '40.000', 'Grupo Atlas Varejo', '58.442.111/0001-27');
    segurar(a, key, 100);

    // Mesmo sacado: estoura a concentração, apesar de sobrar quase todo o limite total.
    const b = await emitir(token, '20.000', 'Grupo Atlas Varejo', '58.442.111/0001-27');
    const veredito = cabeNaCapacidade(key, getDuplicata(b)!);
    expect(veredito.ok).toBe(false);
    expect(veredito.motivo).toBe('limite_por_sacado');

    // Outro sacado, mesmo valor: cabe. É concentração, não tamanho.
    const c = await emitir(token, '20.000', 'Distribuidora Bom Preço', '11.222.333/0001-44');
    expect(cabeNaCapacidade(key, getDuplicata(c)!).ok).toBe(true);
  });

  it('não conta duas vezes a duplicata que esta mesma seguradora já cobre', async () => {
    const { token } = await cedente();
    const key = `cap-${unique()}`;
    setInsurerLimits(key, 50_000, null);
    const id = await emitir(token, '45.000');
    segurar(id, key, 100);

    // Reavaliar a MESMA apólice na MESMA seguradora não pode somar 45.000 de novo e
    // aparecer como estouro de um limite que ela já ocupa legitimamente.
    expect(cabeNaCapacidade(key, getDuplicata(id)!).ok).toBe(true);
  });

  it('remover o limite volta a não haver enforcement, e não vira zero', async () => {
    const { token } = await cedente();
    const key = `cap-${unique()}`;
    setInsurerLimits(key, 10_000, null);
    const id = await emitir(token, '90.000');
    expect(cabeNaCapacidade(key, getDuplicata(id)!).ok).toBe(false);

    setInsurerLimits(key, null, null);
    expect(cabeNaCapacidade(key, getDuplicata(id)!).ok).toBe(true);
  });
});

describe('o painel da seguradora mostra o prêmio realmente cobrado', () => {
  it('soma o registrado em insurance_settlements, não o percentual fixo do catálogo', async () => {
    const seg = getUserByEmail('seguradora@lastro.demo');
    expect(seg?.insurer_key).toBeTruthy();
    const { token } = await cedente();

    // Prêmio deliberadamente diferente do premioPct fixo do catálogo ('too' = 0,55%):
    // 0,55% de 200.000 daria 1.100, e o valor realmente cobrado aqui é 1.234.
    // (fmtBRL arredonda pra reais inteiros, então o prêmio do teste é inteiro de propósito —
    // o que se está provando é de ONDE vem o número, não a formatação.)
    const id = await emitir(token, '200.000');
    const antes = buildSeguradoraPayload(seg!);
    segurar(id, seg!.insurer_key!, 1234);
    const depois = buildSeguradoraPayload(seg!);

    const linha = depois.apolices.find((a) => a.id === id);
    expect(linha).toBeTruthy();
    expect(linha!.premioFmt).toBe(fmtBRL(1234));
    // E o total cresceu exatamente do valor cobrado — não de 0,55% × 200.000 = 1.100.
    const delta = brl(depois.totalPremioFmt) - brl(antes.totalPremioFmt);
    expect(delta).toBe(1234);
    expect(delta).not.toBe(1100);
  });

  it('apólice sem liquidação registrada aparece como "não registrado", não como um valor estimado', async () => {
    const seg = getUserByEmail('seguradora@lastro.demo');
    const { token } = await cedente();
    const id = await emitir(token, '77.000');
    // Seguradora definida sem nunca ter havido cobrança — dado semeado/legado.
    setInsurer(id, seg!.insurer_key!);

    const payload = buildSeguradoraPayload(seg!);
    const linha = payload.apolices.find((a) => a.id === id);
    expect(linha!.premioFmt).toBe('não registrado');
  });

  it('expõe a exposição e a capacidade declarada junto do resto do painel', async () => {
    const seg = getUserByEmail('seguradora@lastro.demo');
    setInsurerLimits(seg!.insurer_key!, 5_000_000, 400_000);
    const payload = buildSeguradoraPayload(seg!);
    expect(payload.exposicao).toBeTruthy();
    expect(payload.exposicao!.limiteTotal).toBe(5_000_000);
    expect(payload.exposicao!.limitePorSacado).toBe(400_000);
    expect(typeof payload.exposicao!.usoTotalPct).toBe('number');
    setInsurerLimits(seg!.insurer_key!, null, null);
    // Sem limite, o uso é null — "não se aplica", nunca 0%, que sugeriria folga total.
    expect(buildSeguradoraPayload(seg!).exposicao!.usoTotalPct).toBeNull();
  });
});

describe('a contratação respeita a capacidade', () => {
  async function investidorCredenciado() {
    const email = `inv-cap-${unique()}@example.com`;
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ nome: 'Investidor Cap', email, password: 'senha123', companyName: 'Fundo Cap', role: 'investidor' });
    const { approveKyb } = await import('../src/db/users.js');
    approveKyb(reg.body.user.id);
    return reg.body.token as string;
  }

  it('recusa POST /market/:id/insure com 409 quando a seguradora não comporta o risco', async () => {
    const seg = getUserByEmail('seguradora@lastro.demo');
    const { token: cedToken } = await cedente();
    const invToken = await investidorCredenciado();

    const id = await emitir(cedToken, '60.000');
    setAceiteStatus(ensureAceite(id, 'aceite no teste').id, 'aceita');
    setInsurerLimits(seg!.insurer_key!, 1_000, null); // teto absurdamente baixo, de propósito

    const res = await request(app)
      .post(`/api/market/${id}/insure`)
      .set('Authorization', `Bearer ${invToken}`)
      .send({ key: seg!.insurer_key });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('sem_capacidade');
    // E a recusa não pode ter deixado a duplicata meio-segurada.
    expect(getDuplicata(id)!.insurer_key).not.toBe(seg!.insurer_key);

    setInsurerLimits(seg!.insurer_key!, null, null);
    const depois = await request(app)
      .post(`/api/market/${id}/insure`)
      .set('Authorization', `Bearer ${invToken}`)
      .send({ key: seg!.insurer_key });
    expect(depois.status).toBe(200);
  });

  it('a oferta marca quem não tem capacidade e não recomenda essa seguradora', async () => {
    const seg = getUserByEmail('seguradora@lastro.demo');
    const invToken = await investidorCredenciado();
    setInsurerLimits(seg!.insurer_key!, 1_000, null);

    const market = await request(app).get('/api/market').set('Authorization', `Bearer ${invToken}`);
    const oferta = market.body.offers[0];
    const semCapacidade = oferta.insurerOptions.find((o: { key: string }) => o.key === seg!.insurer_key);
    expect(semCapacidade.temCapacidade).toBe(false);
    expect(semCapacidade.motivoSemCapacidade).toBeTruthy();
    expect(semCapacidade.recommended).toBe(false);
    // Alguém com capacidade continua sendo recomendado — a tela não fica sem recomendação.
    const recomendada = oferta.insurerOptions.find((o: { recommended: boolean }) => o.recommended);
    expect(recomendada.temCapacidade).toBe(true);

    setInsurerLimits(seg!.insurer_key!, null, null);
  });
});

/** 'R$ 1.234,56' → 1234.56 */
function brl(fmt: string): number {
  return parseFloat(fmt.replace(/[^\d,-]/g, '').replace(/\./g, '').replace(',', '.'));
}
