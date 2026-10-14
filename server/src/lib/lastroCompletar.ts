import { getDuplicata, setLastro, setSacadoCnpj, setStatus } from '../db/duplicatas.js';
import { addNotification, getUploadForDuplicata } from '../db/misc.js';
import { recordAuditEvent } from '../db/audit.js';
import { effectiveOwnerId } from '../db/users.js';
import { cnpjChecksumValido } from './cnpjLookup.js';
import { COLORS } from '../data/seed.js';
import { tentarLeilaoAutomatico } from './pilotoAutomatico.js';
import type { DuplicataRow, UserRow } from '../db/types.js';

// Completar o lastro DEPOIS da emissão.
//
// Abaixo de 100% no checklist (lib/emitirCore.ts) a duplicata nasce 'pendente_analise', e
// nada no sistema a tirava de lá: abrirLeilao exige lastro_pct === 100 e status 'aprovada'
// (lib/auctionOpen.ts), e a revisão humana do back-office só cobre 'suspensa_compliance'.
// A planilha CSV, a emissão automática do ERP e o agente de IA emitem sem anexos — então tudo
// o que eles criavam ficava travado para sempre, e a empresa não tinha como receber.
//
// Aqui a duplicata é reavaliada com o que existe DE VERDADE: os itens que já valiam na
// emissão (lastro_itens, migração 0077) mais o que foi anexado a ela depois (uploads com
// duplicata_id, migração 0075) e o CNPJ do sacado gravado. Ao chegar em 100%, sai de
// 'pendente_analise' para 'aprovada' — a mesma regra que já valia para quem emitia completo.

type Acao = { tipo: 'upload'; kind: string } | { tipo: 'cnpj' } | null;

interface ItemDef {
  key: string;
  label: string;
  // Como a empresa resolve este item pela tela de Minhas Duplicatas.
  acao: Acao;
  // Os tipos de upload que cumprem o item.
  kinds?: string[];
}

const ITENS: ItemDef[] = [
  { key: 'sacado_cnpj', label: 'CNPJ do sacado', acao: { tipo: 'cnpj' } },
  { key: 'valor_vencimento', label: 'Valor e vencimento', acao: null },
  { key: 'nota_fiscal', label: 'Nota fiscal (NF-e ou NFS-e)', acao: { tipo: 'upload', kind: 'nfe' }, kinds: ['nfe', 'nfse'] },
  { key: 'comprovante_entrega', label: 'Comprovante de entrega ou de execução do serviço', acao: { tipo: 'upload', kind: 'comprovante_entrega' }, kinds: ['comprovante_entrega'] },
  { key: 'pedido_compra', label: 'Pedido de compra ou contrato comercial', acao: { tipo: 'upload', kind: 'pedido_compra' }, kinds: ['pedido_compra'] },
  { key: 'historico_sacado', label: 'Histórico de pagamento do sacado consultado', acao: null },
];

/** Os kinds de upload que, anexados a uma duplicata, podem completar o lastro. */
export const KINDS_DE_LASTRO = new Set(ITENS.flatMap((i) => i.kinds ?? []));

function itensDaEmissao(d: DuplicataRow): Record<string, boolean> {
  // Duplicata anterior à migração 0077 que já tinha 100%: a emissão validou tudo, só não
  // guardou item a item.
  if (!d.lastro_itens && d.lastro_pct === 100) return Object.fromEntries(ITENS.map((i) => [i.key, true]));
  if (!d.lastro_itens) return {};
  try {
    return JSON.parse(d.lastro_itens) as Record<string, boolean>;
  } catch {
    return {};
  }
}

function cumpridoAgora(item: ItemDef, d: DuplicataRow): boolean {
  switch (item.key) {
    case 'sacado_cnpj':
      return cnpjChecksumValido(d.sacado_cnpj.replace(/\D/g, ''));
    case 'valor_vencimento':
      return d.valor > 0 && !!d.vencimento;
    case 'historico_sacado':
      return !!d.sacado_nome;
    default:
      return (item.kinds ?? []).some((k) => !!getUploadForDuplicata(d.id, k));
  }
}

export interface ChecklistDaDuplicata {
  pct: number;
  itens: Record<string, boolean>;
  faltando: { key: string; label: string; acao: Acao }[];
}

export function checklistDaDuplicata(d: DuplicataRow): ChecklistDaDuplicata {
  const emissao = itensDaEmissao(d);
  const itens: Record<string, boolean> = {};
  for (const item of ITENS) itens[item.key] = emissao[item.key] === true || cumpridoAgora(item, d);
  const feitos = ITENS.filter((i) => itens[i.key]).length;
  return {
    pct: Math.round((feitos / ITENS.length) * 100),
    itens,
    faltando: ITENS.filter((i) => !itens[i.key]).map((i) => ({ key: i.key, label: i.label, acao: i.acao })),
  };
}

/**
 * Recalcula o lastro e, se completou, libera a duplicata para leilão. Só mexe em
 * 'pendente_analise' — uma duplicata suspensa por compliance continua esperando a revisão
 * humana, e uma já aprovada/vendida não tem o que liberar.
 */
export function reavaliarLastro(duplicataId: string): { liberada: boolean; checklist: ChecklistDaDuplicata } | null {
  const d = getDuplicata(duplicataId);
  if (!d) return null;
  const checklist = checklistDaDuplicata(d);
  if (d.status !== 'pendente_analise') return { liberada: false, checklist };
  setLastro(d.id, checklist.pct, checklist.itens);
  if (checklist.pct < 100) return { liberada: false, checklist };

  setStatus(d.id, 'aprovada');
  recordAuditEvent(d.cedente_id, d.cedente_nome, 'duplicata.lastro_completo', { duplicataId: d.id });
  if (d.cedente_id) {
    addNotification(
      d.cedente_id,
      `Documentos completos: a duplicata ${d.id} (${d.sacado_nome}) está pronta — assim que o sacado confirmar, você já pode abrir o leilão.`,
      COLORS.GREEN,
      'aceite'
    );
  }
  // Se o sacado já tinha confirmado, a duplicata está pronta: o piloto automático abre o leilão.
  tentarLeilaoAutomatico(d.id);
  return { liberada: true, checklist };
}

export type InformarCnpjOutcome =
  | { status: 200; body: { liberada: boolean; checklist: ChecklistDaDuplicata } }
  | { status: 400; body: { error: 'validation_error'; message: string } }
  | { status: 404; body: { error: 'not_found'; message: string } }
  | { status: 409; body: { error: 'not_pending'; message: string } };

/** O CNPJ do sacado que faltou na emissão (comum no CSV e no ERP). */
export function informarCnpjDoSacado(user: UserRow, duplicataId: string, cnpjRaw: string): InformarCnpjOutcome {
  const d = getDuplicata(duplicataId);
  if (!d || d.cedente_id !== effectiveOwnerId(user)) {
    return { status: 404, body: { error: 'not_found', message: 'Duplicata não encontrada.' } };
  }
  if (d.status !== 'pendente_analise') {
    return { status: 409, body: { error: 'not_pending', message: 'Esta duplicata não está aguardando documentos.' } };
  }
  const digits = cnpjRaw.replace(/\D/g, '');
  if (!cnpjChecksumValido(digits)) {
    return { status: 400, body: { error: 'validation_error', message: 'CNPJ inválido — confira os 14 dígitos.' } };
  }
  setSacadoCnpj(d.id, cnpjRaw.trim());
  recordAuditEvent(user.id, user.company_name, 'duplicata.cnpj_sacado_informado', { duplicataId: d.id });
  return { status: 200, body: reavaliarLastro(d.id)! };
}
