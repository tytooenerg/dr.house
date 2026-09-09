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

/** Uma linha da listagem. Traz o valor em número, além do formatado, porque quem integra
 * costuma somar/comparar antes de exibir. */
export interface DuplicataListItem {
  id: string;
  status: string;
  sacado: string;
  valor: number;
  valorFmt: string;
  emissao: string;
  vencimento: string;
  registro: string | null;
  registradora: string | null;
  lastroPct: number;
  seguro: boolean;
  reservaTaxaAm: number | null;
  closeAt: string | null;
}

export interface DuplicataListPage {
  total: number;
  limit: number;
  offset: number;
  mode: 'live' | 'test';
  duplicatas: DuplicataListItem[];
}

export interface ListDuplicatasQuery {
  status?: string;
  limit?: number;
  offset?: number;
}

export interface AbrirLeilaoInput {
  /** Reserva: o pior deságio mensal que o cedente aceita, entre 0 e 20 (% a.m.). */
  taxaMaxima?: number | string;
  /** Prazo do leilão em horas. Padrão 6, teto 168. */
  duracaoHoras?: number;
}

export interface AbrirLeilaoResult {
  duplicataId: string;
  closeAt: string;
  reservaTaxaAm: number | null;
  mode: 'live' | 'test';
}

/** Uma rodada de uma negociação de balcão: quem propôs, quanto, e quando. */
export interface OtcRodada {
  papel: 'comprador' | 'vendedor';
  autor: string;
  valorFmt: string;
  nota: string | null;
  quando: string;
}

export interface OtcNegociacao {
  id: number;
  duplicataId: string;
  sacado: string;
  valorFaceFmt: string;
  vencimento: string;
  /** O seu lado da mesa nesta negociação. */
  meuPapel: 'comprador' | 'vendedor';
  contraparte: string;
  valor: number;
  valorFmt: string;
  /** Se true, a proposta em cima da mesa é da contraparte e cabe a você responder. */
  minhaVez: boolean;
  status: 'aberta' | 'aceita' | 'recusada' | 'cancelada' | 'expirada';
  expiraEm: string;
  rodadas: OtcRodada[];
}

export interface AbrirOtcInput {
  duplicataId: string;
  /** Proposta em reais. */
  valor: number | string;
  /** Validade da proposta em horas. Padrão 48, teto 168. */
  prazoHoras?: number;
  nota?: string;
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
