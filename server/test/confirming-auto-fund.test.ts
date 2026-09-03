import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { getFundoBalance } from '../src/db/confirmingFundo.js';
import { getProgramaBySacado } from '../src/db/confirming.js';
import { getDuplicata } from '../src/db/duplicatas.js';
import { computePurchasePrice } from '../src/lib/marketCompute.js';

beforeAll(async () => {
  await seedIfEmpty();
});

function unique(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function register(role: 'cedente' | 'sacado' | 'investidor', companyName: string) {
  const email = `${unique(role)}@example.com`;
  const res = await request(app).post('/api/auth/register').send({ nome: 'Teste', email, password: 'senha123', companyName, role });
  return { token: res.body.token as string, userId: res.body.user.id as number };
}

// Grupo Atlas Varejo tem perfil interno seedado (score 84 → rating AA) — a única forma
// determinística de dar ao programa uma taxa real sem depender de sinais de rede. Usado só
// pelo CNPJ na criação do programa, não pelo nome da conta sacado (que é o que amarra a
// emissão ao programa — ver lib/confirmingCore.ts's tentarFinanciarViaPrograma).
const CNPJ_COM_HISTORICO = '12.345.678/0001-90';

// /api/emitir/submit passa pelo registro simulado (~12% de indisponibilidade de
// propósito) — retry até 5x, mesmo padrão de aceites-disputas.test.ts.
async function emitirComRetry(token: string, body: Record<string, unknown>) {
  let res = await request(app).post('/api/emitir/submit').set('Authorization', `Bearer ${token}`).send(body);
  for (let attempt = 0; attempt < 4 && res.status !== 200; attempt++) {
    res = await request(app).post('/api/emitir/submit').set('Authorization', `Bearer ${token}`).send(body);
  }
  return res;
}

// Checklist de lastro precisa bater 100% (nfAnexada + os demais campos) pra emitirCore.ts
// sequer tentar o financiamento automático — mesmo gate que already existe pra uma
// duplicata chegar em 'aprovada' em vez de 'pendente_analise'.
function formCompleto(sacado: string, valor: string) {
  return { sacado, cnpj: '99.999.999/0001-99', valor, vencimento: '2026-12-01', seguro: false, nfAnexada: true, batchValores: [] };
}

async function criarProgramaEMatricular(sacadoToken: string, cedenteUserId: number, limite = '500.000') {
  await request(app).post('/api/confirming/criar').set('Authorization', `Bearer ${sacadoToken}`).send({ cnpj: CNPJ_COM_HISTORICO, limite });
  await request(app).post('/api/confirming/membros').set('Authorization', `Bearer ${sacadoToken}`).send({ cedenteUserId });
}

// tentarFinanciarViaPrograma só financia se o fundo tiver caixa real pra isso (ver
// getFundoBalance() check em confirmingCore.ts) — sem aporte, o teste cairia no fallback
// 'fundo_insuficiente' em vez de financiar.
async function aportarNoFundo(valor: number) {
  const { token } = await register('investidor', unique('Investidor Fundo'));
  await request(app).post('/api/confirming-fundo/contribuir').set('Authorization', `Bearer ${token}`).send({ valor });
}

describe('Financiamento automático — cedente matriculado pula o leilão', () => {
  it('funds the duplicata instantly at emission, skipping dispararLeilao entirely', async () => {
    const sacadoCompany = unique('Sacado Programa');
    const { token: sacadoToken, userId: sacadoUserId } = await register('sacado', sacadoCompany);
    const { token: cedenteToken, userId: cedenteUserId } = await register('cedente', unique('Fornecedor Confirmado'));
    await criarProgramaEMatricular(sacadoToken, cedenteUserId);
    await aportarNoFundo(50000);

    const balanceBefore = getFundoBalance();
    const emit = await emitirComRetry(cedenteToken, formCompleto(sacadoCompany, '10.000'));
    expect(emit.status).toBe(200);
    expect(emit.body.financiadoViaPrograma).toBe(true);

    // O fundo pagou pela compra de verdade — saldo do pool caiu no preço com deságio
    // (lib/marketCompute.ts's computePurchasePrice, na taxa negociada do programa), não no
    // valor de face — mesmo cálculo que lib/confirmingCore.ts's tentarFinanciarViaPrograma
    // faz de verdade antes de financiar.
    const duplicata = getDuplicata(emit.body.duplicataId)!;
    const programa = getProgramaBySacado(sacadoUserId)!;
    const { precoCompra } = computePurchasePrice(duplicata, programa.taxa_am);
    expect(getFundoBalance()).toBeCloseTo(balanceBefore - precoCompra, 6);

    // A duplicata foi direto pra 'vendida' — nunca passou por 'no_mercado', e não há mais
    // leilão pra disparar (canDisparar reflete isso).
    const minhas = await request(app).get('/api/minhas').set('Authorization', `Bearer ${cedenteToken}`);
    const dup = minhas.body.duplicatas.find((d: { status: string }) => d.status === 'Vendida');
    expect(dup).toBeDefined();
    expect(dup.canDisparar).toBe(false);

    // O programa e a matrícula do cedente registraram o uso.
    const meuPrograma = await request(app).get('/api/confirming/meu-programa').set('Authorization', `Bearer ${sacadoToken}`);
    expect(meuPrograma.body.programa.utilizadoFmt).toContain('10.000');
  });

  it('a cedente not enrolled in any program follows the normal marketplace flow, unaffected', async () => {
    const sacadoCompany = unique('Sacado Sem Matricula');
    const { token: sacadoToken } = await register('sacado', sacadoCompany);
    await request(app).post('/api/confirming/criar').set('Authorization', `Bearer ${sacadoToken}`).send({ cnpj: CNPJ_COM_HISTORICO, limite: '500.000' });

    const { token: cedenteToken } = await register('cedente', unique('Fornecedor Não Matriculado'));
    const emit = await emitirComRetry(cedenteToken, formCompleto(sacadoCompany, '5.000'));
    expect(emit.status).toBe(200);
    expect(emit.body.financiadoViaPrograma).toBe(false);

    const minhas = await request(app).get('/api/minhas').set('Authorization', `Bearer ${cedenteToken}`);
    const dup = minhas.body.duplicatas.find((d: { status: string }) => d.status === 'Aprovada');
    expect(dup).toBeDefined();
    expect(dup.canDisparar).toBe(true);
  });

  it('a paused program never auto-funds, even for an enrolled cedente', async () => {
    const sacadoCompany = unique('Sacado Pausado');
    const { token: sacadoToken } = await register('sacado', sacadoCompany);
    const { token: cedenteToken, userId: cedenteUserId } = await register('cedente', unique('Fornecedor Programa Pausado'));
    await criarProgramaEMatricular(sacadoToken, cedenteUserId);
    await request(app).post('/api/confirming/pausar').set('Authorization', `Bearer ${sacadoToken}`);

    const emit = await emitirComRetry(cedenteToken, formCompleto(sacadoCompany, '5.000'));
    expect(emit.status).toBe(200);
    expect(emit.body.financiadoViaPrograma).toBe(false);
  });

  it('falls back to the normal flow when the fund has no real cash, even with room in the program', async () => {
    const sacadoCompany = unique('Sacado Fundo Vazio');
    const { token: sacadoToken } = await register('sacado', sacadoCompany);
    const { token: cedenteToken, userId: cedenteUserId } = await register('cedente', unique('Fornecedor Fundo Vazio'));
    await criarProgramaEMatricular(sacadoToken, cedenteUserId);
    // Nenhum aporte feito — o programa tem limite de sobra, mas o fundo não tem caixa real
    // pra financiar. tentarFinanciarViaPrograma deve recusar (motivo fundo_insuficiente) em
    // vez de deixar o saldo do fundo ir negativo. O que precisa faltar é o preço COM
    // deságio (computePurchasePrice), não o valor de face — pedir só balanceBefore + 1000
    // de face não bastaria mais, já que o preço real pago é sempre menor que a face (o
    // desconto máximo é limitado a 60% — ver MAX_DESCONTO_PCT em lib/marketCompute.ts), por
    // isso o valor de face pedido aqui é generosamente maior que o caixa disponível.
    const balanceBefore = getFundoBalance();

    const emit = await emitirComRetry(cedenteToken, formCompleto(sacadoCompany, String(Math.round(balanceBefore * 3) + 1000)));
    expect(emit.status).toBe(200);
    expect(emit.body.financiadoViaPrograma).toBe(false);
    expect(getFundoBalance()).toBe(balanceBefore);

    const minhas = await request(app).get('/api/minhas').set('Authorization', `Bearer ${cedenteToken}`);
    const dup = minhas.body.duplicatas.find((d: { status: string }) => d.status === 'Aprovada');
    expect(dup).toBeDefined();
    expect(dup.canDisparar).toBe(true);
  });

  it('respects the program limit — over it, falls back to the normal flow instead of over-financing', async () => {
    const sacadoCompany = unique('Sacado Limite Baixo');
    const { token: sacadoToken } = await register('sacado', sacadoCompany);
    const { token: cedenteToken, userId: cedenteUserId } = await register('cedente', unique('Fornecedor Estourou Limite'));
    await criarProgramaEMatricular(sacadoToken, cedenteUserId, '10.000');

    const emit = await emitirComRetry(cedenteToken, formCompleto(sacadoCompany, '50.000'));
    expect(emit.status).toBe(200);
    expect(emit.body.financiadoViaPrograma).toBe(false);
  });

  it('respects a per-cedente sublimite even when the program limit has room', async () => {
    const sacadoCompany = unique('Sacado Sublimite');
    const { token: sacadoToken } = await register('sacado', sacadoCompany);
    const { token: cedenteToken, userId: cedenteUserId } = await register('cedente', unique('Fornecedor Sublimite'));
    await request(app).post('/api/confirming/criar').set('Authorization', `Bearer ${sacadoToken}`).send({ cnpj: CNPJ_COM_HISTORICO, limite: '500.000' });
    await request(app).post('/api/confirming/membros').set('Authorization', `Bearer ${sacadoToken}`).send({ cedenteUserId, sublimite: '5.000' });

    const emit = await emitirComRetry(cedenteToken, formCompleto(sacadoCompany, '20.000'));
    expect(emit.status).toBe(200);
    expect(emit.body.financiadoViaPrograma).toBe(false);
  });

  it('never auto-funds a sandbox-mode emission', async () => {
    // opts.sandbox só é passado pelo caminho de partner API — replicado aqui chamando o
    // core diretamente, já que o único caminho de rota pra sandbox exige uma chave de
    // API de teste completa (fora do escopo deste teste específico).
    const { submitEmitir, emitirFormSchema } = await import('../src/lib/emitirCore.js');
    const { getUserById } = await import('../src/db/users.js');
    const sacadoCompany = unique('Sacado Sandbox');
    const { token: sacadoToken } = await register('sacado', sacadoCompany);
    const { userId: cedenteUserId } = await register('cedente', unique('Fornecedor Sandbox'));
    await criarProgramaEMatricular(sacadoToken, cedenteUserId);

    const cedenteUser = getUserById(cedenteUserId)!;
    const form = emitirFormSchema.parse(formCompleto(sacadoCompany, '5.000'));
    const outcome = await submitEmitir(cedenteUser, form, { sandbox: true });
    expect(outcome.status).toBe(200);
    if (outcome.status === 200) {
      expect(outcome.body.financiadoViaPrograma).toBe(false);
    }
  });
});
