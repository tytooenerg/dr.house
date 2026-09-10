import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import { listByCedente, getDuplicata } from '../db/duplicatas.js';
import { effectiveOwnerId } from '../db/users.js';
import { aceiteConfirmado } from '../lib/aceiteCore.js';
import { fmtBRL } from '../lib/format.js';
import { estimateRateBand } from '../lib/dynamicPricing.js';
import { auctionCountdown, computePurchasePrice, viewAuctionLadder } from '../lib/marketCompute.js';
import { abrirLeilao } from '../lib/auctionOpen.js';
import { ratingFromScore } from '../lib/riscoCore.js';
import { COLORS } from '../data/seed.js';

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

  // O leilão que o dono da duplicata não via.
  //
  // A disputa é o produto: vários financiadores competindo, menor deságio ganha. Ela era
  // desenhada em detalhe no card do MARKETPLACE — nome, veículo, taxa, "Melhor lance",
  // contagem regressiva — e o cedente, dono da duplicata sendo disputada, recebia daqui só
  // `status: 'No mercado'`. Abria o leilão e esperava no escuro até fechar. O comentário do
  // veículo em lib/marketCompute.ts afirma o direito com todas as letras ("o cedente tem o
  // direito de saber se quem está financiando é um banco, um FIDC, um fundo ou uma
  // factoring") — e era exatamente esse o leitor que não recebia.
  //
  // Mesma escada, mesma ordem de vitória, mesma formatação: viewAuctionLadder.
  const emLeilao = d.status === 'no_mercado';
  const lances = emLeilao ? viewAuctionLadder(d.id) : [];
  const leilao = emLeilao
    ? {
        totalLances: lances.length,
        melhorTaxaFmt: lances[0]?.taxaFmt ?? null,
        melhorPrecoFmt: lances[0]?.precoFmt ?? null,
        fechaEm: auctionCountdown(d.close_at).countdown,
        fechaEmSec: auctionCountdown(d.close_at).remainingSec,
        lances,
      }
    : null;

  // A simulação de antes de abrir: o que a banda de mercado de hoje pagaria por esta
  // duplicata. `reservaSugeridaAm` já vinha e só virava uma frase de ajuda; em reais ela
  // vira a resposta da pergunta que o cedente de fato faz ("quanto eu recebo?").
  const bandaAm = estimateRateBand(ratingFromScore(d.score ?? 60)).mid;

  return {
    leilao,
    precoEstimadoFmt: fmtBRL(computePurchasePrice(d, bandaAm).precoCompra),
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
    reservaSugeridaAm: bandaAm,
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

// Os gates, a validação da reserva e o evento 'leilao.aberto' vivem em lib/auctionOpen.ts —
// esta rota é só a porta da tela pra ele, e devolve a lista atualizada porque é disso que a
// tela precisa pra rerenderizar.
minhasRouter.post('/:id/leilao', (req, res) => {
  const parsed = leilaoSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
    return;
  }
  const out = abrirLeilao(req.user!, req.params.id, { reservaTaxaAm: parsed.data.taxaMaxima });
  if (out.status !== 200) {
    res.status(out.status).json(out.body);
    return;
  }
  res.json({ duplicatas: listByCedente(effectiveOwnerId(req.user!)).map(view) });
});
