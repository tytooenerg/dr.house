import { z } from 'zod';
import {
  cancelPayable,
  createPayable,
  deletePayable,
  getPayable,
  listByCedente,
  markPayablePaid,
  type PayableRow,
} from '../db/payables.js';
import { fmtBRL } from './format.js';
import { parseFlexibleDate } from './format.js';

export const PAYABLE_CATEGORIAS = ['fornecedores', 'folha', 'impostos', 'aluguel', 'outros'] as const;
export type PayableCategoria = (typeof PAYABLE_CATEGORIAS)[number];

export const createPayableSchema = z.object({
  descricao: z.string().trim().min(1).max(200),
  fornecedor: z.string().trim().max(200).optional().default(''),
  categoria: z.enum(PAYABLE_CATEGORIAS).optional().default('outros'),
  valor: z.number().positive(),
  vencimento: z.string().trim().min(8),
  recorrente: z.boolean().optional().default(false),
});

// 'atrasado' is never stored — it's always derived from today's date vs vencimento, the
// same "don't let a status field go stale without a cron" discipline the platform already
// uses elsewhere (e.g. suspicious-activity flags computed on read, not cached).
function isOverdue(p: PayableRow): boolean {
  if (p.status !== 'pendente') return false;
  return parseFlexibleDate(p.vencimento).getTime() < startOfToday();
}

function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export interface PayableView {
  id: number;
  descricao: string;
  fornecedor: string;
  categoria: string;
  valor: number;
  valorFmt: string;
  vencimento: string;
  status: 'pendente' | 'pago' | 'cancelado';
  atrasado: boolean;
  recorrente: boolean;
  paidAt: string | null;
}

function toView(p: PayableRow): PayableView {
  return {
    id: p.id,
    descricao: p.descricao,
    fornecedor: p.fornecedor,
    categoria: p.categoria,
    valor: p.valor,
    valorFmt: fmtBRL(p.valor),
    vencimento: p.vencimento,
    status: p.status,
    atrasado: isOverdue(p),
    recorrente: !!p.recorrente,
    paidAt: p.paid_at,
  };
}

export interface PayablesOverview {
  items: PayableView[];
  totalPendenteFmt: string;
  totalAtrasadoFmt: string;
  totalPendente: number;
  totalAtrasado: number;
  countAtrasado: number;
}

export function buildPayablesOverview(cedenteId: number): PayablesOverview {
  const items = listByCedente(cedenteId).map(toView);
  const pendentes = items.filter((i) => i.status === 'pendente');
  const atrasados = pendentes.filter((i) => i.atrasado);
  const totalPendente = pendentes.reduce((sum, i) => sum + i.valor, 0);
  const totalAtrasado = atrasados.reduce((sum, i) => sum + i.valor, 0);
  return {
    items,
    totalPendenteFmt: fmtBRL(totalPendente),
    totalAtrasadoFmt: fmtBRL(totalAtrasado),
    totalPendente,
    totalAtrasado,
    countAtrasado: atrasados.length,
  };
}

export function addPayable(cedenteId: number, input: z.infer<typeof createPayableSchema>): PayableView {
  const row = createPayable({
    cedenteId,
    descricao: input.descricao,
    fornecedor: input.fornecedor ?? '',
    categoria: input.categoria ?? 'outros',
    valor: input.valor,
    vencimento: input.vencimento,
    recorrente: !!input.recorrente,
  });
  return toView(row);
}

export type PayableActionOutcome =
  | { status: 200; body: { ok: true } }
  | { status: 404; body: { error: 'not_found'; message: string } }
  | { status: 403; body: { error: 'forbidden'; message: string } };

function guardOwnership(id: number, cedenteId: number): PayableActionOutcome | null {
  const row = getPayable(id);
  if (!row) return { status: 404, body: { error: 'not_found', message: 'Conta a pagar não encontrada.' } };
  if (row.cedente_id !== cedenteId) return { status: 403, body: { error: 'forbidden', message: 'Esta conta a pagar não pertence à sua empresa.' } };
  return null;
}

export function markPaid(id: number, cedenteId: number): PayableActionOutcome {
  const guard = guardOwnership(id, cedenteId);
  if (guard) return guard;
  markPayablePaid(id);
  return { status: 200, body: { ok: true } };
}

export function cancel(id: number, cedenteId: number): PayableActionOutcome {
  const guard = guardOwnership(id, cedenteId);
  if (guard) return guard;
  cancelPayable(id);
  return { status: 200, body: { ok: true } };
}

export function remove(id: number, cedenteId: number): PayableActionOutcome {
  const guard = guardOwnership(id, cedenteId);
  if (guard) return guard;
  deletePayable(id);
  return { status: 200, body: { ok: true } };
}
