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
import { fmtBRL, parseBRLNumber } from './format.js';
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

// CSV import — closes the gap called out in README's "AI CFO, Contas a Pagar..." section:
// every payable used to be typed in one at a time, unlike duplicatas which already has
// both manual emission and a CSV lote path (lib/emitirCore.ts's submitEmitirLote). Same
// shape: parsed entirely client-side (no file leaves the browser as a raw upload, just
// parsed rows as JSON), each row validated and created through the exact same addPayable()
// a manual single entry uses — not a separate, lighter-weight path.
export const MAX_LOTE_ROWS = 200;

const importPayableRowSchema = createPayableSchema.extend({ valor: z.string().trim().min(1) });

export interface PayableLoteRowResult {
  index: number;
  descricao: string;
  ok: boolean;
  id?: number;
  error?: string;
}

export interface PayableLoteOutcome {
  total: number;
  sucesso: number;
  falhas: number;
  resultados: PayableLoteRowResult[];
}

export function importPayablesLote(
  cedenteId: number,
  rawRows: unknown[]
): { status: 200 | 400; body: PayableLoteOutcome | { error: string; message: string } } {
  if (rawRows.length === 0) return { status: 400, body: { error: 'empty_batch', message: 'Envie ao menos uma linha.' } };
  if (rawRows.length > MAX_LOTE_ROWS) {
    return { status: 400, body: { error: 'batch_too_large', message: `Máximo de ${MAX_LOTE_ROWS} linhas por lote (recebido: ${rawRows.length}).` } };
  }

  const resultados: PayableLoteRowResult[] = [];
  for (let i = 0; i < rawRows.length; i++) {
    const raw = rawRows[i] as Record<string, unknown> | undefined;
    const label = typeof raw?.descricao === 'string' && raw.descricao ? raw.descricao : `linha ${i + 1}`;
    const parsed = importPayableRowSchema.safeParse(raw);
    if (!parsed.success) {
      resultados.push({ index: i, descricao: label, ok: false, error: `Linha inválida: ${parsed.error.issues.map((issue) => issue.message).join('; ')}` });
      continue;
    }
    const valorNum = parseBRLNumber(parsed.data.valor);
    if (!valorNum || valorNum <= 0) {
      resultados.push({ index: i, descricao: parsed.data.descricao, ok: false, error: 'Valor inválido.' });
      continue;
    }
    const view = addPayable(cedenteId, { ...parsed.data, valor: valorNum });
    resultados.push({ index: i, descricao: parsed.data.descricao, ok: true, id: view.id });
  }

  const sucesso = resultados.filter((r) => r.ok).length;
  return { status: 200, body: { total: rawRows.length, sucesso, falhas: rawRows.length - sucesso, resultados } };
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
