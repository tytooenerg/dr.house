import { getSettings, updateSettings, getUserById, getSacadoAccountByCompanyName } from '../db/users.js';
import type { UserRow, DuplicataRow } from '../db/types.js';
import { createPurchase } from '../db/duplicatas.js';
import {
  getMembro,
  getProgramaById,
  getProgramaBySacado,
  insertPrograma,
  listMatriculasByCedente,
  listMembrosByPrograma,
  listProgramas,
  setMembroStatus,
  setMembroUtilizado,
  setProgramaStatus,
  setProgramaUtilizado,
  upsertMembro,
  type ConfirmingMembroComCedente,
  type ConfirmingProgramaRow,
} from '../db/confirming.js';
import { listAceitesBySacadoNome } from '../db/aceites.js';
import { listOpenDisputesByCedente } from '../db/disputes.js';
import { buildBlendedRiscoViewSync } from './riscoCore.js';
import { estimateRateBand } from './dynamicPricing.js';
import { settlePurchase } from './settlement.js';
import { computePurchasePrice } from './marketCompute.js';
import { fundoFinanciarCompra, getOrCreateFundoSistemaUserId } from './confirmingFundo.js';
import { getFundoBalance } from '../db/confirmingFundo.js';
import { fmtBRL, parseBRLNumber } from './format.js';

// Programa Confirming / Risco Sacado — o sacado (comprador) pré-aprova um programa de
// financiamento pra sua cadeia de fornecedores, na mesma banda de taxa que já se
// aplicaria a ele no mercado aberto (buildBlendedRiscoViewSync + estimateRateBand, as
// mesmas funções que precificam qualquer oferta hoje) — sem inventar um modelo de
// precificação novo. Esta é só a fundação: criar/pausar o programa e matricular
// cedentes elegíveis. O pulo do leilão em si (financiamento automático na emissão) e o
// fundo de fomento que capitaliza isso vêm em features seguintes.

const MIN_LIMITE = 10_000;
const MAX_LIMITE = 5_000_000;

export function fmtTaxaAm(taxaAm: number): string {
  return taxaAm.toFixed(1).replace('.', ',') + '% a.m.';
}

export interface ProgramaView {
  id: number;
  sacadoCnpj: string;
  rating: string;
  taxaAmFmt: string;
  limiteFmt: string;
  utilizadoFmt: string;
  disponivelFmt: string;
  status: 'ativo' | 'pausado';
  membros: { id: number; cedenteNome: string; cedenteEmail: string; sublimiteFmt: string | null; status: 'ativo' | 'removido' }[];
}

function buildProgramaView(programa: ConfirmingProgramaRow): ProgramaView {
  const membros = listMembrosByPrograma(programa.id).map((m: ConfirmingMembroComCedente) => ({
    id: m.id,
    cedenteNome: m.cedente_nome,
    cedenteEmail: m.cedente_email,
    sublimiteFmt: m.sublimite !== null ? fmtBRL(m.sublimite) : null,
    status: m.status,
  }));
  return {
    id: programa.id,
    sacadoCnpj: programa.sacado_cnpj,
    rating: programa.rating,
    taxaAmFmt: fmtTaxaAm(programa.taxa_am),
    limiteFmt: fmtBRL(programa.limite),
    utilizadoFmt: fmtBRL(programa.utilizado),
    disponivelFmt: fmtBRL(Math.max(0, programa.limite - programa.utilizado)),
    status: programa.status,
    membros,
  };
}

export function getMeuPrograma(sacadoUser: UserRow): ProgramaView | null {
  const programa = getProgramaBySacado(sacadoUser.id);
  return programa ? buildProgramaView(programa) : null;
}

export type CriarProgramaOutcome = { status: 200; body: ProgramaView } | { status: 400 | 409; body: { error: string; message: string } };

// O sacado autodeclara seu próprio CNPJ aqui (persistido em settings.companyCnpj, mesmo
// campo genérico que o AI CFO usa pro cedente) em vez de exigir uma tela de configuração
// separada primeiro — um passo só. A taxa NUNCA é escolhida pelo sacado: sai de
// buildBlendedRiscoViewSync (score real interno + sinais de rede pra esse CNPJ) via
// estimateRateBand, pra não dar ao sacado como se dar a própria taxa.
export function criarPrograma(sacadoUser: UserRow, cnpj: string, limiteStr: string): CriarProgramaOutcome {
  const cnpjTrimmed = cnpj.trim();
  if (!cnpjTrimmed) {
    return { status: 400, body: { error: 'cnpj_ausente', message: 'Informe o CNPJ da sua empresa.' } };
  }
  if (getProgramaBySacado(sacadoUser.id)) {
    return { status: 409, body: { error: 'programa_existente', message: 'Você já tem um Programa Confirming — pause-o antes de recriar.' } };
  }
  const riskView = buildBlendedRiscoViewSync(cnpjTrimmed);
  if (!riskView) {
    return {
      status: 400,
      body: {
        error: 'sem_historico',
        message: 'Não há histórico suficiente (nem interno, nem de sinais de rede) para calcular uma taxa para este CNPJ ainda.',
      },
    };
  }
  const limite = parseBRLNumber(limiteStr);
  if (limite < MIN_LIMITE || limite > MAX_LIMITE) {
    return {
      status: 400,
      body: { error: 'limite_invalido', message: `O limite do programa deve estar entre ${fmtBRL(MIN_LIMITE)} e ${fmtBRL(MAX_LIMITE)}.` },
    };
  }

  updateSettings(sacadoUser.id, { companyCnpj: cnpjTrimmed });
  const taxaAm = estimateRateBand(riskView.rating).mid;
  const programa = insertPrograma({ sacadoUserId: sacadoUser.id, sacadoCnpj: cnpjTrimmed, rating: riskView.rating, taxaAm, limite });
  return { status: 200, body: buildProgramaView(programa) };
}

export type ProgramaAcaoOutcome = { status: 200; body: ProgramaView } | { status: 404; body: { error: string; message: string } };

function requirePrograma(sacadoUser: UserRow): ConfirmingProgramaRow | null {
  const programa = getProgramaBySacado(sacadoUser.id);
  return programa ?? null;
}

export function pausarPrograma(sacadoUser: UserRow): ProgramaAcaoOutcome {
  const programa = requirePrograma(sacadoUser);
  if (!programa) return { status: 404, body: { error: 'programa_nao_encontrado', message: 'Você ainda não tem um Programa Confirming.' } };
  setProgramaStatus(programa.id, 'pausado');
  return { status: 200, body: buildProgramaView(getProgramaById(programa.id)!) };
}

export function reativarPrograma(sacadoUser: UserRow): ProgramaAcaoOutcome {
  const programa = requirePrograma(sacadoUser);
  if (!programa) return { status: 404, body: { error: 'programa_nao_encontrado', message: 'Você ainda não tem um Programa Confirming.' } };
  setProgramaStatus(programa.id, 'ativo');
  return { status: 200, body: buildProgramaView(getProgramaById(programa.id)!) };
}

export interface CedenteElegivel {
  cedenteUserId: number;
  cedenteNome: string;
  volumeHistoricoFmt: string;
  sublimiteSugeridoFmt: string;
  disputasAbertas: number;
  jaMatriculado: boolean;
}

// Sugere cedentes com histórico real de aceite contra este sacado (não uma lista
// arbitrária) — reaproveita listAceitesBySacadoNome, a mesma consulta que já resolve
// aceites pendentes pro Portal do Sacado, agregando por cedente. Ordenado por volume
// (quem mais already fez negócio primeiro) em vez de ordem arbitrária de inserção, com
// duas informações a mais que a lista bruta anterior não dava: um sublimite sugerido —
// a média real do que esse cedente já emitiu contra este sacado, não um número
// inventado — e disputas em aberto contra o cedente (listOpenDisputesByCedente, o mesmo
// sinal que já gate a linha de crédito rotativa em lib/creditLine.ts), pro sacado ver
// risco antes de matricular, não só volume.
export function listarCedentesElegiveis(sacadoUser: UserRow): CedenteElegivel[] {
  const aceites = listAceitesBySacadoNome(sacadoUser.company_name);
  const programa = getProgramaBySacado(sacadoUser.id);
  const porCedente = new Map<number, { nome: string; total: number; count: number }>();
  for (const a of aceites) {
    if (a.cedente_id === null) continue;
    const atual = porCedente.get(a.cedente_id) ?? { nome: a.cedente_nome, total: 0, count: 0 };
    atual.total += a.valor;
    atual.count += 1;
    porCedente.set(a.cedente_id, atual);
  }
  const membrosAtivos = programa ? new Set(listMembrosByPrograma(programa.id).filter((m) => m.status === 'ativo').map((m) => m.cedente_user_id)) : new Set<number>();
  return [...porCedente.entries()]
    .map(([cedenteUserId, info]) => ({
      cedenteUserId,
      cedenteNome: info.nome,
      volumeHistoricoFmt: fmtBRL(info.total),
      sublimiteSugeridoFmt: fmtBRL(Math.round(info.total / info.count)),
      disputasAbertas: listOpenDisputesByCedente(cedenteUserId).length,
      jaMatriculado: membrosAtivos.has(cedenteUserId),
      _volumeTotal: info.total,
    }))
    .sort((a, b) => b._volumeTotal - a._volumeTotal)
    .map(({ _volumeTotal: _omit, ...rest }) => rest);
}

export type MatricularOutcome = { status: 200; body: ProgramaView } | { status: 400 | 404; body: { error: string; message: string } };

export function matricular(sacadoUser: UserRow, cedenteUserId: number, sublimiteStr: string | null): MatricularOutcome {
  const programa = requirePrograma(sacadoUser);
  if (!programa) return { status: 404, body: { error: 'programa_nao_encontrado', message: 'Você ainda não tem um Programa Confirming.' } };
  const cedente = getUserById(cedenteUserId);
  if (!cedente || cedente.role !== 'cedente') {
    return { status: 400, body: { error: 'cedente_invalido', message: 'Cedente não encontrado.' } };
  }
  const sublimite = sublimiteStr ? parseBRLNumber(sublimiteStr) : null;
  if (sublimite !== null && sublimite <= 0) {
    return { status: 400, body: { error: 'sublimite_invalido', message: 'O sublimite, se informado, precisa ser maior que zero.' } };
  }
  upsertMembro(programa.id, cedenteUserId, sublimite);
  return { status: 200, body: buildProgramaView(getProgramaById(programa.id)!) };
}

export function desmatricular(sacadoUser: UserRow, membroId: number): MatricularOutcome {
  const programa = requirePrograma(sacadoUser);
  if (!programa) return { status: 404, body: { error: 'programa_nao_encontrado', message: 'Você ainda não tem um Programa Confirming.' } };
  const membro = listMembrosByPrograma(programa.id).find((m) => m.id === membroId);
  if (!membro) return { status: 404, body: { error: 'membro_nao_encontrado', message: 'Matrícula não encontrada neste programa.' } };
  setMembroStatus(membroId, 'removido');
  return { status: 200, body: buildProgramaView(getProgramaById(programa.id)!) };
}

export interface MinhaMatriculaView {
  sacadoNome: string;
  taxaAmFmt: string;
  sublimiteFmt: string | null;
  programaAtivo: boolean;
}

// O que um cedente vê: em quais programas de sacados ele está matriculado agora.
export function listMinhasMatriculas(cedenteUser: UserRow): MinhaMatriculaView[] {
  return listMatriculasByCedente(cedenteUser.id).map((m) => ({
    sacadoNome: m.sacado_nome,
    taxaAmFmt: fmtTaxaAm(m.taxa_am),
    sublimiteFmt: m.sublimite !== null ? fmtBRL(m.sublimite) : null,
    programaAtivo: m.programa_status === 'ativo',
  }));
}

// Reexpõe o settings.companyCnpj já persistido (se houver) pra pré-preencher o formulário
// de criação — evita o sacado ter que redigitar o CNPJ se já o informou noutro lugar.
export function getCompanyCnpj(user: UserRow): string {
  return getSettings(user).companyCnpj;
}

export type FinanciamentoAutomaticoResultado =
  | { financiado: true }
  | {
      financiado: false;
      motivo: 'sacado_sem_conta' | 'sem_programa_ativo' | 'nao_matriculado' | 'limite_programa_excedido' | 'sublimite_excedido' | 'fundo_insuficiente';
    };

// O coração do Programa Confirming: chamado por lib/emitirCore.ts's submitEmitir logo
// depois que a duplicata está de fato aprovada (checklist 100%, não suspensa pelo
// Compliance AI Engine) — nunca antes, pra não financiar algo que ainda pode ser barrado
// segundos depois. Identifica o sacado pela mesma amarração de nome que o resto do app já
// usa (getSacadoAccountByCompanyName — igual ao aceite, igual à notificação de emissão),
// não por CNPJ: manter uma única fonte de verdade pra "quem é este sacado".
//
// Quando financia: pula o leilão de vez (a duplicata nunca passa por 'no_mercado' — vai
// direto pra 'vendida' via createPurchase/settlePurchase, os mesmos usados por uma compra
// manual no mercado aberto ou pelo auto-bid), na taxa do próprio programa, com capital do
// Fundo de Fomento do Confirming (lib/confirmingFundo.ts), nunca do caixa da Lastro. O
// aceite continua rodando sem alteração nenhuma — o financiamento não espera a confirmação
// do sacado (esse é o ponto do "confirming": financiar na hora, e uma contestação
// posterior cai no fluxo de disputa que já existe pra qualquer duplicata comprada.
export async function tentarFinanciarViaPrograma(duplicata: DuplicataRow, cedenteUser: UserRow): Promise<FinanciamentoAutomaticoResultado> {
  const sacadoAccount = getSacadoAccountByCompanyName(duplicata.sacado_nome);
  if (!sacadoAccount) return { financiado: false, motivo: 'sacado_sem_conta' };

  const programa = getProgramaBySacado(sacadoAccount.id);
  if (!programa || programa.status !== 'ativo') return { financiado: false, motivo: 'sem_programa_ativo' };

  const membro = getMembro(programa.id, cedenteUser.id);
  if (!membro || membro.status !== 'ativo') return { financiado: false, motivo: 'nao_matriculado' };

  if (programa.utilizado + duplicata.valor > programa.limite) return { financiado: false, motivo: 'limite_programa_excedido' };
  if (membro.sublimite !== null && membro.utilizado + duplicata.valor > membro.sublimite) {
    return { financiado: false, motivo: 'sublimite_excedido' };
  }
  // O que o fundo de fato precisa ter em caixa é o preço com deságio (precoCompra), não o
  // valor de face — igual a qualquer outro comprador (lib/marketCompute.ts's
  // computePurchasePrice), usando a taxa negociada do próprio programa (programa.taxa_am)
  // em vez da estimativa genérica de mercado, já que esse é o contrato real. Sem esta
  // checagem, um programa com limite alto e zero aporte real financiaria do mesmo jeito,
  // deixando o ledger do fundo negativo — exatamente o risco de capital próprio que este
  // desenho inteiro existe pra evitar (mesmo princípio de drawCreditLine checar
  // getFundBalance() antes de liberar um saque).
  const { precoCompra } = computePurchasePrice(duplicata, programa.taxa_am);
  if (getFundoBalance() < precoCompra) return { financiado: false, motivo: 'fundo_insuficiente' };

  const fundoUserId = await getOrCreateFundoSistemaUserId();
  createPurchase(duplicata.id, fundoUserId, duplicata.valor, fmtTaxaAm(programa.taxa_am));
  settlePurchase({ duplicataId: duplicata.id, sacadoNome: duplicata.sacado_nome, investorId: fundoUserId, cedenteId: cedenteUser.id, valor: duplicata.valor, precoCompra });
  fundoFinanciarCompra(duplicata.id, precoCompra);
  setProgramaUtilizado(programa.id, programa.utilizado + duplicata.valor);
  setMembroUtilizado(membro.id, membro.utilizado + duplicata.valor);

  return { financiado: true };
}

// A partir daqui, utilização ≥ 80% do limite acende o alerta pro admin — mesmo tipo de
// limiar preventivo já usado alhures no código (ex.: threshold de compliance), pra dar
// tempo do sacado ajustar o limite antes do programa travar todo mundo por falta de espaço.
const UTILIZACAO_ALERTA_PCT = 80;

export interface ProgramaAdminView {
  id: number;
  sacadoNome: string;
  sacadoEmail: string;
  rating: string;
  taxaAmFmt: string;
  limiteFmt: string;
  utilizadoFmt: string;
  disponivelFmt: string;
  status: 'ativo' | 'pausado';
  membrosAtivos: number;
  utilizacaoPct: number;
  alertaLimite: boolean;
}

// Visão de oversight do admin — todo programa que já existe, quantos cedentes matriculados
// cada um tem, e quanto já financiou. Somente leitura: quem cria/gerencia um programa é o
// próprio sacado (routes/confirming.ts), nunca o admin.
export function listProgramasParaAdmin(): ProgramaAdminView[] {
  return listProgramas().map((p) => {
    const utilizacaoPct = p.limite > 0 ? Math.round((p.utilizado / p.limite) * 100) : 0;
    return {
      id: p.id,
      sacadoNome: p.sacado_nome,
      sacadoEmail: p.sacado_email,
      rating: p.rating,
      taxaAmFmt: fmtTaxaAm(p.taxa_am),
      limiteFmt: fmtBRL(p.limite),
      utilizadoFmt: fmtBRL(p.utilizado),
      disponivelFmt: fmtBRL(Math.max(0, p.limite - p.utilizado)),
      status: p.status,
      membrosAtivos: listMembrosByPrograma(p.id).filter((m) => m.status === 'ativo').length,
      utilizacaoPct,
      alertaLimite: p.status === 'ativo' && utilizacaoPct >= UTILIZACAO_ALERTA_PCT,
    };
  });
}

export interface ConfirmingHealthSummary {
  headroomTotalFmt: string;
  fundoBalanceFmt: string;
  fundoSuficiente: boolean;
}

// Sinal real de liquidez, não cosmético: soma quanto os programas ATIVOS ainda podem
// prometer financiar (limite - utilizado) e compara com o caixa de verdade que o fundo
// tem agora (getFundoBalance — o mesmo saldo que tentarFinanciarViaPrograma checa antes
// de financiar). limite é uma promessa do sacado; só o saldo do fundo é dinheiro real —
// se a soma prometida passar do caixa disponível, algum financiamento futuro vai cair no
// fallback 'fundo_insuficiente' mesmo com programa/matrícula/limite em dia, e o admin
// deveria saber disso antes de acontecer, não depois.
export function buildConfirmingHealthSummary(): ConfirmingHealthSummary {
  const headroomTotal = listProgramas()
    .filter((p) => p.status === 'ativo')
    .reduce((sum, p) => sum + Math.max(0, p.limite - p.utilizado), 0);
  const balance = getFundoBalance();
  return {
    headroomTotalFmt: fmtBRL(headroomTotal),
    fundoBalanceFmt: fmtBRL(balance),
    fundoSuficiente: balance >= headroomTotal,
  };
}
