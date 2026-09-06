import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import { listByCedente, getDuplicata, dispararLeilao } from '../db/duplicatas.js';
import { effectiveOwnerId } from '../db/users.js';
import { aceiteConfirmado } from '../lib/aceiteCore.js';
import { fmtBRL } from '../lib/format.js';
import { estimateRateBand } from '../lib/dynamicPricing.js';
import { ratingFromScore } from '../lib/riscoCore.js';
import { COLORS } from '../data/seed.js';

// Teto de sanidade pra taxa de reserva. Não é uma regra de mercado — é uma barreira contra
// dedo errado (digitar "150" quando queria "1,50"), que a essa altura significaria aceitar
// entregar a duplicata quase de graça.
const RESERVA_MAX_PCT = 20;

const leilaoSchema = z.object({ taxaMaxima: z.union([z.number(), z.string()]).optional() });

export const minhasRouter = Router();
minhasRouter.use(requireAuth);

const STATUS_META: Record<string, { bg: string; color: string; label: string }> = {
  no_mercado: { bg: '#E9EEFB', color: COLORS.BLUE, label: 'No mercado' },
  pendente_analise: { bg: '#FBF1E0', color: COLORS.AMBER, label: 'Pendente análise' },
  paga: { bg: '#EAF3EE', color: COLORS.GREEN, label: 'Paga' },
  aprovada: { bg: '#EAF3EE', color: COLORS.GREEN, label: 'Aprovada' },
  vendida: { bg: '#E9EEFB', color: COLORS.BLUE, label: 'Vendida' },
  suspensa_compliance: { bg: '#F7E9E7', color: COLORS.RED, label: 'Em revisão de compliance' },
  rejeitada: { bg: '#F7E9E7', color: COLORS.RED, label: 'Rejeitada na revisão' },
};

function view(d: ReturnType<typeof getDuplicata>) {
  if (!d) return null;
  const meta = STATUS_META[d.status] ?? { bg: '#F0F2F5', color: '#5B6472', label: d.status };
  return {
    id: d.id,
    sacado: d.sacado_nome,
    valorFmt: fmtBRL(d.valor),
    emissao: d.emissao,
    vencimento: d.vencimento,
    status: meta.label,
    statusBg: meta.bg,
    statusColor: meta.color,
    lastroFmt: d.lastro_pct + '%',
    // Banda de mercado de HOJE pro rating deste sacado — sugestão pro cedente escolher a
    // reserva com referência, não um número que a plataforma impõe por ele.
    reservaSugeridaAm: estimateRateBand(ratingFromScore(d.score ?? 60)).mid,
    reservaTaxaAm: d.reserva_taxa_am,
    lastroColor: d.lastro_pct === 100 ? COLORS.GREEN : d.lastro_pct >= 60 ? COLORS.AMBER : COLORS.RED,
    canDisparar: d.lastro_pct === 100 && d.status === 'aprovada' && aceiteConfirmado(d.id),
    aguardandoAceite: d.status === 'aprovada' && !aceiteConfirmado(d.id),
  };
}

minhasRouter.get('/', (req, res) => {
  if (req.user!.role !== 'cedente') {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  const duplicatas = listByCedente(effectiveOwnerId(req.user!)).map(view);
  res.json({ duplicatas });
});

minhasRouter.post('/:id/leilao', (req, res) => {
  const d = getDuplicata(req.params.id);
  if (!d || d.cedente_id !== req.user!.id) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  if (d.lastro_pct !== 100 || d.status !== 'aprovada') {
    res.status(409).json({ error: 'not_ready', message: 'Esta duplicata ainda não está pronta para leilão.' });
    return;
  }
  // Achado corrigido: uma duplicata só pode entrar em negociação depois que o sacado
  // aceita (explícito ou tácito, ver lib/aceiteCore.ts's aceiteConfirmado) — antes disso
  // nem chega a 'no_mercado', pra que compra direta/cesta/auto-bid, que operam sobre
  // listMarketplace(), fiquem protegidos de graça.
  if (!aceiteConfirmado(d.id)) {
    res.status(409).json({
      error: 'aceite_pendente',
      message: 'Aguardando aceite do sacado (ou o prazo tácito vencer) antes de poder negociar esta duplicata.',
    });
    return;
  }
  // A reserva é do cedente: é ele quem diz o pior deságio que aceita. Opcional pra não
  // quebrar quem já chamava esta rota sem corpo — nesse caso vale a banda de mercado, o
  // comportamento antigo (ver reserveRate em lib/auctionCore.ts).
  const parsed = leilaoSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
    return;
  }
  const raw = parsed.data.taxaMaxima;
  let reserva: number | undefined;
  if (raw !== undefined && String(raw).trim() !== '') {
    reserva = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(',', '.'));
    if (!Number.isFinite(reserva) || reserva <= 0 || reserva > RESERVA_MAX_PCT) {
      res.status(400).json({
        error: 'validation_error',
        message: `A taxa máxima precisa ser um número entre 0 e ${RESERVA_MAX_PCT}% a.m.`,
      });
      return;
    }
  }
  dispararLeilao(d.id, new Date(Date.now() + 6 * 3600 * 1000).toISOString(), reserva);
  res.json({ duplicatas: listByCedente(req.user!.id).map(view) });
});
