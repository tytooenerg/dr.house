import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { listByCedente, getDuplicata, dispararLeilao } from '../db/duplicatas.js';
import { effectiveOwnerId } from '../db/users.js';
import { aceiteConfirmado } from '../lib/aceiteCore.js';
import { fmtBRL } from '../lib/format.js';
import { COLORS } from '../data/seed.js';

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
  dispararLeilao(d.id, new Date(Date.now() + 6 * 3600 * 1000).toISOString());
  res.json({ duplicatas: listByCedente(req.user!.id).map(view) });
});
