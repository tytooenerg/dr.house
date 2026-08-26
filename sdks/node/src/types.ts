// Mirrors the real Zod schemas / response shapes in server/src/routes/v1.ts and its
// helper modules (lib/emitirCore.ts, lib/aceiteCore.ts, lib/seguradoraCore.ts) — hand
// written from the actual route code, not generated, so a drift between this file and the
// server is possible if the server changes without this SDK being updated. GET
// /api/v1/openapi.json is the always-current machine-readable source of truth.

export interface EmitirDuplicataInput {
  sacado: string;
  cnpj?: string;
  valor: string;
  vencimento: string;
  seguro?: boolean;
  nfAnexada?: boolean;
  nfeChave?: string;
  batchValores?: string[];
}

export interface EmitirDuplicataResult {
  ok: true;
  duplicataId: string;
  registro: string;
  registradora: string;
  seguro: boolean;
  complianceSuspensa: boolean;
  mode: 'live' | 'test';
}

export interface DuplicataView {
  id: string;
  status: string;
  sacado: string;
  cedente: string;
  valorFmt: string;
  vencimento: string;
  registro: string | null;
  registradora: string | null;
  lastroPct: number;
  seguro: boolean;
}

// Retornado por GET /duplicatas (lista) — mais completo que DuplicataView (que espelha
// GET /duplicatas/:id): traz valor numérico, sacadoCnpj, emissão e score, pensado pra
// cálculos de DSO/aging/concentração no lado do parceiro, não só exibição.
export interface DuplicataListItem {
  id: string;
  status: string;
  sacado: string;
  sacadoCnpj: string;
  valor: number;
  valorFmt: string;
  emissao: string;
  vencimento: string;
  lastroPct: number;
  seguro: boolean;
  score: number | null;
}

export interface MarketplaceOffer {
  id: string;
  sacado: string;
  cedente: string;
  valor: number;
  valorFmt: string;
  desagio: string;
  vencimento: string;
  score: number;
  [key: string]: unknown;
}

export interface AceiteView {
  id: number;
  duplicataId: string;
  status: 'aguardando' | 'aceita' | 'contestada';
  [key: string]: unknown;
}

export type AceiteStatus = 'aceita' | 'contestada';

export interface SeguradoraPayload {
  [key: string]: unknown;
}

export type SinistroDecision = 'aprovado' | 'negado';

export interface DecidirSinistroInput {
  decision: SinistroDecision;
  note: string;
}

export interface ScoreView {
  cnpj: string;
  score: number;
  rating: string;
  [key: string]: unknown;
}

export type SinalTipo = 'pagamento_pontual' | 'atraso' | 'protesto' | 'contestacao';

export interface ReportSignalInput {
  tipo: SinalTipo;
  nota?: string;
}

export interface PldTriagemInput {
  nome: string;
  documento?: string;
}

export interface PldTriagemResult {
  nome: string;
  flagged: boolean;
  match: { nome: string; tipo: string; fonte: string } | null;
}

export interface PayableView {
  id: number;
  descricao: string;
  fornecedor: string;
  categoria: string;
  valorFmt: string;
  valor: number;
  vencimento: string;
  status: 'pendente' | 'pago' | 'cancelado';
  recorrente: boolean;
}

export interface CashflowHorizonPoint {
  days: number;
  receitaEsperadaFmt: string;
  despesaEsperadaFmt: string;
  saldoProjetadoFmt: string;
  saldoProjetado: number;
  deficit: boolean;
}

export interface CashflowScenarioResult {
  scenario: 'pessimista' | 'base' | 'otimista';
  points: CashflowHorizonPoint[];
}

export interface CashflowInsight {
  tipo: 'deficit' | 'antecipacao_recomendada' | 'ok';
  mensagem: string;
}

export interface CashflowForecast {
  disponivelParaAntecipacaoFmt: string;
  disponivelParaAntecipacao: number;
  totalRecebiveisPendentesFmt: string;
  totalContasAPagarPendentesFmt: string;
  scenarios: CashflowScenarioResult[];
  insights: CashflowInsight[];
  geradoEm: string;
}
