import { z } from 'zod';
import type { UserRow } from '../db/types.js';
import { listActiveListings } from '../db/resaleListings.js';
import { supersedeOtherActiveBids } from '../db/resaleBids.js';
import { getDuplicata } from '../db/duplicatas.js';
import { addBlockTradeItem, createBlockTrade, listBlockTradeItems, listMyBlockTrades } from '../db/blockTrades.js';
import { executeResaleTrade, parseValor, viewResaleMarket, type ResaleOutcome } from './resaleCore.js';
import { addNotification } from '../db/misc.js';
import { recordAuditEvent } from '../db/audit.js';
import { fmtBRL } from './format.js';
import { COLORS } from '../data/seed.js';

// Institutional block trade — a single negotiated transaction that sweeps several active
// resale listings at once, real enough that it needs its own eligibility bar, minimum size,
// and audit trail, not just "the same buy button, called in a loop". Distinguishing traits
// vs. an ordinary resale purchase:
//  - restricted to accounts that declared a large enough patrimônio líquido on KYB (the
//    same institutional sub-types — banco, FIDC, fintech de crédito, family office — that
//    already make up every investidor account on this platform; see README "Roles"),
//  - a minimum aggregate size, below which this is just a regular purchase wearing a
//    fancier name,
//  - a volume-based discount on the *platform's own fee* for the buyer — never a markdown
//    on what each seller actually receives; every swept listing is still bought at exactly
//    its posted asking price, the same price any other buyer would have paid it.
export const INSTITUTIONAL_PL_THRESHOLD = 10_000_000;
export const MIN_BLOCK_TRADE_VALOR = 300_000;

function feeDiscountPctFor(valorTotal: number): number {
  if (valorTotal >= 5_000_000) return 0.3;
  if (valorTotal >= 1_000_000) return 0.2;
  return 0.1; // every qualifying block trade clears MIN_BLOCK_TRADE_VALOR, so this is the floor
}

export const blockTradeCriteriaSchema = z.object({
  valorMaximo: z.string().trim(),
  scoreMin: z.number().int().min(0).max(100).optional(),
  quantidadeMax: z.number().int().positive().max(50).optional(),
});

export type BlockTradeCriteria = z.infer<typeof blockTradeCriteriaSchema>;

function isInstitutional(user: UserRow): boolean {
  try {
    const form = JSON.parse(user.kyb_form || '{}') as Record<string, string>;
    return parseValor(form.pl || '0') >= INSTITUTIONAL_PL_THRESHOLD;
  } catch {
    return false;
  }
}

export interface BlockTradeResult {
  blockTradeId: number;
  quantidade: number;
  valorTotalFmt: string;
  descontoPct: number;
  itens: { duplicataId: string; valorFmt: string }[];
  market: ReturnType<typeof viewResaleMarket>;
}

// Greedy, best-value-first fill: sorts candidate listings by how big a discount to face
// value they already carry (biggest first — the same signal viewResaleMarket's
// `variacaoPct` shows), then takes as many as fit the buyer's budget and criteria. This is
// a reasonable, honest matching heuristic for a prototype order-sweep, not a claim of
// optimal execution — a real institutional desk's smart-order-router would weigh sacado
// concentration, duration, and more.
export function runBlockTrade(user: UserRow, criteriaRaw: BlockTradeCriteria): ResaleOutcome<BlockTradeResult> {
  if (user.role !== 'investidor') {
    return { status: 403, body: { error: 'forbidden', message: 'Apenas contas de investidor podem executar block trades.' } };
  }
  if (user.kyb_status !== 'approved') {
    return { status: 403, body: { error: 'kyb_required', message: 'Seu credenciamento institucional ainda está em análise.' } };
  }
  if (!isInstitutional(user)) {
    return {
      status: 403,
      body: {
        error: 'not_institutional',
        message: `Block trades exigem patrimônio líquido declarado no KYB de pelo menos ${fmtBRL(INSTITUTIONAL_PL_THRESHOLD)}.`,
      },
    };
  }
  const valorMaximo = parseValor(criteriaRaw.valorMaximo);
  if (valorMaximo < MIN_BLOCK_TRADE_VALOR) {
    return {
      status: 400,
      body: { error: 'validation_error', message: `O orçamento do block trade precisa ser de pelo menos ${fmtBRL(MIN_BLOCK_TRADE_VALOR)}.` },
    };
  }

  const candidates = listActiveListings()
    .filter((l) => l.seller_id !== user.id)
    .filter((l) => criteriaRaw.scoreMin == null || (l.score ?? 0) >= criteriaRaw.scoreMin)
    .map((l) => ({ ...l, discountRatio: l.original_valor > 0 ? (l.original_valor - l.asking_valor) / l.original_valor : 0 }))
    .sort((a, b) => b.discountRatio - a.discountRatio);

  const matched: typeof candidates = [];
  let running = 0;
  for (const c of candidates) {
    if (criteriaRaw.quantidadeMax && matched.length >= criteriaRaw.quantidadeMax) break;
    if (running + c.asking_valor > valorMaximo) continue; // skip, a smaller one further down might still fit
    matched.push(c);
    running += c.asking_valor;
  }

  if (matched.length === 0) {
    return { status: 409, body: { error: 'no_match', message: 'Nenhum anúncio ativo se encaixa nos critérios e no orçamento informado.' } };
  }
  if (running < MIN_BLOCK_TRADE_VALOR) {
    return {
      status: 409,
      body: {
        error: 'below_minimum',
        message: `Os anúncios disponíveis dentro do orçamento somam apenas ${fmtBRL(running)} — abaixo do mínimo de ${fmtBRL(MIN_BLOCK_TRADE_VALOR)} para um block trade.`,
      },
    };
  }

  const descontoPct = feeDiscountPctFor(running);
  const blockTrade = createBlockTrade({ buyerId: user.id, criteria: criteriaRaw, quantidade: matched.length, valorTotal: running, descontoPct: descontoPct * 100 });
  const itens: { duplicataId: string; valorFmt: string }[] = [];

  for (const listing of matched) {
    const duplicata = getDuplicata(listing.duplicata_id);
    if (!duplicata) continue; // shouldn't happen — listActiveListings() already joins on it
    executeResaleTrade(listing, duplicata, user.id, listing.asking_valor, descontoPct);
    supersedeOtherActiveBids(listing.id, null);
    addBlockTradeItem(blockTrade.id, listing.id, listing.duplicata_id, listing.seller_id, listing.asking_valor);
    addNotification(
      listing.seller_id,
      `Sua posição na duplicata ${listing.duplicata_id} foi vendida em um block trade institucional por ${fmtBRL(listing.asking_valor)} — o preço pago é exatamente o anunciado.`,
      COLORS.GREEN
    );
    itens.push({ duplicataId: listing.duplicata_id, valorFmt: fmtBRL(listing.asking_valor) });
  }

  recordAuditEvent(user.id, user.company_name, 'resale.block_trade', {
    blockTradeId: blockTrade.id,
    quantidade: matched.length,
    valorTotal: running,
    descontoPct: descontoPct * 100,
  });

  return {
    status: 200,
    body: { blockTradeId: blockTrade.id, quantidade: matched.length, valorTotalFmt: fmtBRL(running), descontoPct: +(descontoPct * 100).toFixed(1), itens, market: viewResaleMarket() },
  };
}

export function viewMyBlockTrades(userId: number) {
  return listMyBlockTrades(userId).map((bt) => ({
    id: bt.id,
    quantidade: bt.quantidade,
    valorTotalFmt: fmtBRL(bt.valor_total),
    descontoPct: bt.desconto_pct,
    createdAt: bt.created_at,
    itens: listBlockTradeItems(bt.id).map((i) => ({ duplicataId: i.duplicata_id, valorFmt: fmtBRL(i.valor) })),
  }));
}
