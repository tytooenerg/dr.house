import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { db } from '../src/db/index.js';
import { createDuplicata, getDuplicata } from '../src/db/duplicatas.js';
import { ensureAceite, setAceiteStatus } from '../src/db/aceites.js';
import { setVeiculo, approveKyb } from '../src/db/users.js';
import { setPlatformSetting } from '../src/db/platformSettings.js';
import { buildResumoFiscalCedente } from '../src/lib/fiscalCedente.js';
import { fiscalAgent } from '../src/lib/agents/fiscal.js';
import { darLance, fecharLeiloes } from './helpers/auction.js';
import { vencimentoFuturo } from './helpers/datas.js';

// A camada fiscal do cedente — o lado da mesa que não existia. O que havia (informe de
// rendimentos, DARF) olha o investidor e a plataforma; quem antecipa não tinha nada, e o IOF
// só virou computável quando a migração 0070 passou a dizer sob qual veículo cada um compra.

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function registrarCedente() {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Cedente Fiscal', email: `ced-fis-${unique()}@example.com`, password: 'senha123', companyName: `Cedente Fiscal ${unique()}`, role: 'cedente' });
  return { token: res.body.token as string, userId: res.body.user.id as number };
}

async function registrarInvestidor(veiculo: 'banco' | 'fidc' | 'fundo' | 'factoring' | null) {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Investidor', email: `inv-fis-${unique()}@example.com`, password: 'senha123', companyName: `Fundo ${unique()}`, role: 'investidor' });
  approveKyb(res.body.user.id);
  if (veiculo) setVeiculo(res.body.user.id, veiculo);
  return { token: res.body.token as string, userId: res.body.user.id as number };
}

/** Cedente emite, sacado aceita, o investidor arremata: uma operação fiscal de verdade. */
async function operacaoNegociada(cedenteId: number, investidorToken: string, valor = 50000) {
  const d = createDuplicata({
    cedenteId,
    cedenteNome: 'Cedente Fiscal',
    sacadoNome: `Sacado Fiscal ${unique()} Ltda`,
    sacadoCnpj: '',
    valor,
    vencimento: vencimentoFuturo(),
    emissao: '10/08/2026',
    status: 'aprovada',
    lastroPct: 100,
    seguro: false,
  });
  setAceiteStatus(ensureAceite(d.id, 'Aceite confirmado na emissão').id, 'aceita');
  const lance = await darLance(investidorToken, d.id);
  expect(lance.status).toBe(200);
  fecharLeiloes(d.id);
  expect(getDuplicata(d.id)!.status).toBe('vendida');
  return d.id;
}

const anoAtual = new Date().getFullYear();

describe('resumo fiscal do cedente — IOF depende do veículo de quem compra', () => {
  it('cessão a factoring é operação de crédito: IOF incide, com o motivo dito', async () => {
    const ced = await registrarCedente();
    const inv = await registrarInvestidor('factoring');
    const dup = await operacaoNegociada(ced.userId, inv.token);

    const resumo = buildResumoFiscalCedente(ced.userId, anoAtual);
    const linha = resumo.linhas.find((l) => l.duplicataId === dup)!;
    expect(linha.iofIncide).toBe('sim');
    expect(linha.iofValor).toBeGreaterThan(0);
    expect(linha.iofMotivo).toContain('operação de crédito');
    expect(resumo.iofTotal).toBeGreaterThan(0);
  });

  it('aquisição por FIDC não é operação de crédito: sem IOF, e o relatório diz por quê', async () => {
    const ced = await registrarCedente();
    const inv = await registrarInvestidor('fidc');
    const dup = await operacaoNegociada(ced.userId, inv.token);

    const resumo = buildResumoFiscalCedente(ced.userId, anoAtual);
    const linha = resumo.linhas.find((l) => l.duplicataId === dup)!;
    expect(linha.iofIncide).toBe('nao');
    expect(linha.iofValor).toBe(0);
    expect(linha.iofMotivo).toContain('não é operação de crédito');
    expect(resumo.iofTotal).toBe(0);
  });

  it('comprador sem veículo classificado sai como INDETERMINADO, nunca como "sem IOF"', async () => {
    const ced = await registrarCedente();
    const inv = await registrarInvestidor('fundo');
    const dup = await operacaoNegociada(ced.userId, inv.token);
    // Simula uma conta legada: aprovada antes da 0070, sem veículo deduzível do KYB antigo.
    db.prepare("UPDATE users SET veiculo = 'nao_informado' WHERE id = ?").run(inv.userId);

    const resumo = buildResumoFiscalCedente(ced.userId, anoAtual);
    const linha = resumo.linhas.find((l) => l.duplicataId === dup)!;
    expect(linha.iofIncide).toBe('indeterminado');
    expect(linha.iofValor).toBeNull();
    expect(linha.iofValorFmt).toBe('—');
    expect(resumo.iofIndeterminadas).toBe(1);
    // O total não pode absorver o desconhecido como zero.
    expect(resumo.iofTotal).toBe(0);
  });
});

describe('resumo fiscal do cedente — os números da operação', () => {
  it('a despesa financeira é o deságio real da compra, não uma estimativa', async () => {
    const ced = await registrarCedente();
    const inv = await registrarInvestidor('fidc');
    const dup = await operacaoNegociada(ced.userId, inv.token, 80000);

    const compra = db.prepare('SELECT valor, retorno FROM purchases WHERE duplicata_id = ?').get(dup) as { valor: number; retorno: number };
    const resumo = buildResumoFiscalCedente(ced.userId, anoAtual);
    const linha = resumo.linhas.find((l) => l.duplicataId === dup)!;

    expect(linha.despesaFinanceira).toBe(compra.retorno);
    expect(linha.precoRecebido).toBe(compra.valor - compra.retorno);
    expect(resumo.despesaFinanceiraTotal).toBe(compra.retorno);
  });

  it('cedente sem operação no ano recebe um resumo vazio e explicado, não um erro', async () => {
    const ced = await registrarCedente();
    const resumo = buildResumoFiscalCedente(ced.userId, anoAtual);
    expect(resumo.operacoes).toBe(0);
    expect(resumo.linhas).toHaveLength(0);
    expect(resumo.avisoRegimeTributario).toContain('regime tributário');
  });

  it('as alíquotas do IOF são sobrescrevíveis, e o relatório diz qual usou', async () => {
    const ced = await registrarCedente();
    const inv = await registrarInvestidor('banco');
    await operacaoNegociada(ced.userId, inv.token);

    const padrao = buildResumoFiscalCedente(ced.userId, anoAtual);
    expect(padrao.aliquotas.origem).toBe('padrao');

    setPlatformSetting('iof_aliquota_diaria_pct', '0.0082');
    setPlatformSetting('iof_aliquota_adicional_pct', '0.38');
    const configurada = buildResumoFiscalCedente(ced.userId, anoAtual);
    expect(configurada.aliquotas.origem).toBe('configurada');
    expect(configurada.iofTotal).toBeGreaterThan(padrao.iofTotal);
    setPlatformSetting('iof_aliquota_diaria_pct', '');
    setPlatformSetting('iof_aliquota_adicional_pct', '');
  });
});

describe('GET /fiscal/resumo', () => {
  it('serve o resumo ao cedente e recusa quem não é cedente', async () => {
    const ced = await registrarCedente();
    const inv = await registrarInvestidor('fidc');
    await operacaoNegociada(ced.userId, inv.token);

    const ok = await request(app).get(`/api/fiscal/resumo?ano=${anoAtual}`).set('Authorization', `Bearer ${ced.token}`);
    expect(ok.status).toBe(200);
    expect(ok.body.operacoes).toBe(1);
    expect(ok.body.aviso).toContain('não apura');

    const negado = await request(app).get('/api/fiscal/resumo').set('Authorization', `Bearer ${inv.token}`);
    expect(negado.status).toBe(403);
  });
});

describe('Agente Fiscal', () => {
  it('nenhuma tool é sensível — o agente lê e explica, não apura nem recolhe', () => {
    expect(fiscalAgent.tools.every((t) => !t.sensitive)).toBe(true);
    expect(fiscalAgent.selfServiceRoles).toEqual(['cedente', 'investidor']);
  });

  it('resumo_fiscal_cedente responde sobre a operação real e recusa conta que não é de cedente', async () => {
    const ced = await registrarCedente();
    const inv = await registrarInvestidor('factoring');
    await operacaoNegociada(ced.userId, inv.token);

    const tool = fiscalAgent.tools.find((t) => t.name === 'resumo_fiscal_cedente')!;
    const out = (await tool.handler({ userId: ced.userId, ano: anoAtual }, { userId: ced.userId } as never)) as {
      operacoes: number;
      linhas: { iofMotivo: string }[];
    };
    expect(out.operacoes).toBe(1);
    expect(out.linhas[0].iofMotivo).toContain('operação de crédito');

    const naoCedente = (await tool.handler({ userId: inv.userId }, { userId: inv.userId } as never)) as { erro?: string };
    expect(naoCedente.erro).toBeTruthy();
  });

  it('explicar_aliquota_ir devolve a faixa da tabela regressiva, sem inventar alíquota', async () => {
    const tool = fiscalAgent.tools.find((t) => t.name === 'explicar_aliquota_ir')!;
    const curto = (await tool.handler({ dias: 100 }, {} as never)) as { aliquota: number; fonte: string };
    const longo = (await tool.handler({ dias: 900 }, {} as never)) as { aliquota: number };
    expect(curto.aliquota).toBe(0.225);
    expect(longo.aliquota).toBe(0.15);
    expect(curto.fonte).toContain('11.033');
  });
});
