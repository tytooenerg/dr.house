import { getSettings, updateSettings, getUserById } from '../db/users.js';
import type { UserRow } from '../db/types.js';
import {
  getProgramaById,
  getProgramaBySacado,
  insertPrograma,
  listMatriculasByCedente,
  listMembrosByPrograma,
  listProgramas,
  setMembroStatus,
  setProgramaStatus,
  upsertMembro,
  type ConfirmingMembroComCedente,
  type ConfirmingProgramaRow,
} from '../db/confirming.js';
import { listAceitesBySacadoNome } from '../db/aceites.js';
import { listOpenDisputesByCedente } from '../db/disputes.js';
import { buildBlendedRiscoViewSync } from './riscoCore.js';
import { estimateRateBand } from './dynamicPricing.js';
import { getFundoBalance } from '../db/confirmingFundo.js';
import { fmtBRL, parseBRLNumber } from './format.js';

// Programa Confirming / Risco Sacado — o sacado (comprador) pré-aprova um programa de
// financiamento pra sua cadeia de fornecedores, na mesma banda de taxa que já se
// aplicaria a ele no mercado aberto (buildBlendedRiscoViewSync + estimateRateBand, as
// mesmas funções que precificam qualquer oferta hoje) — sem inventar um modelo de
// precificação novo. Esta é só a fundação: criar/pausar o programa e matricular
// cedentes elegíveis. O financiamento automático em si (lib/confirmingFundoAutoBuy.ts's
// runFundoAutoBuyTick) mora num arquivo separado — o Fundo de Fomento compra sempre
// dentro do leilão/marketplace real, nunca por um atalho aqui.

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

// O financiamento automático do Programa Confirming (antes chamado daqui, na emissão —
// pulando o leilão inteiramente) foi movido pra lib/confirmingFundoAutoBuy.ts's
// runFundoAutoBuyTick: o Fundo de Fomento agora compra sempre dentro do leilão/marketplace
// real, como qualquer banco ou investidor, nunca por um atalho na emissão. Ver o comentário
// de topo desse arquivo pra por que isso mudou.

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
// tem agora (getFundoBalance — o mesmo saldo que lib/confirmingFundoAutoBuy.ts's
// runFundoAutoBuyTick checa antes de financiar). limite é uma promessa do sacado; só o
// saldo do fundo é dinheiro real —
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
