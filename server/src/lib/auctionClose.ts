import { getDuplicata } from '../db/duplicatas.js';
import { createPurchase } from '../db/duplicatas.js';
import { listActiveAuctionBids, listAuctionsToClose, markAuctionClosed, setAuctionBidStatus } from '../db/auctionBids.js';
import { addNotification } from '../db/misc.js';
import { recordAuditEvent } from '../db/audit.js';
import { settlePurchase } from './settlement.js';
import { informarNegociacao, type RegistradoraKey } from './registradoras.js';
import { deliverWebhookEvent } from './webhookDelivery.js';
import { fmtTaxa } from './auctionCore.js';
import { fmtBRL } from './format.js';
import { logger } from './logger.js';
import { COLORS } from '../data/seed.js';
import { getFundoSistemaUserIdIfExists } from './confirmingFundo.js';
import { settleFundoWin } from './confirmingFundoAutoBuy.js';

// Adjudicação do leilão primário: no close_at, o MENOR deságio ativo vence e a duplicata é
// liquidada pelo preço congelado naquele lance. Empate desempata por quem lançou antes
// (a ordem já vem de listActiveAuctionBids).
//
// Nenhum lance elegível => a duplicata NÃO vende. Ela fica marcada como fechada
// (leilao_fechado_em) e o cedente é avisado pra reofertar — em vez de ser vendida a um
// preço que ninguém propôs, que era o comportamento antigo de "quem clica primeiro leva".
export interface AuctionCloseResult {
  fechados: number;
  vendidos: number;
  semLance: number;
}

export function closeDueAuctions(nowIso = new Date().toISOString(), apenasDuplicataId?: string): AuctionCloseResult {
  const due = listAuctionsToClose(nowIso, apenasDuplicataId);
  let vendidos = 0;
  let semLance = 0;

  for (const { id } of due) {
    const d = getDuplicata(id);
    if (!d) continue;
    const bids = listActiveAuctionBids(id);

    if (bids.length === 0) {
      markAuctionClosed(id, nowIso);
      semLance++;
      if (d.cedente_id) {
        addNotification(
          d.cedente_id,
          `Leilão de ${d.sacado_nome} encerrou sem lances dentro da reserva — você pode reofertar a duplicata.`,
          COLORS.AMBER,
          'leilao'
        );
      }
      recordAuditEvent(null, 'Leilão', 'leilao.encerrado_sem_lance', { duplicataId: id });
      continue;
    }

    const [vencedor, ...perdedores] = bids;
    // Marca antes de liquidar: se settlePurchase falhar, o leilão não fica aberto pra ser
    // adjudicado de novo no próximo ciclo com um estado financeiro pela metade.
    markAuctionClosed(id, nowIso);
    setAuctionBidStatus(vencedor.id, 'vencedor');
    for (const p of perdedores) setAuctionBidStatus(p.id, 'perdedor');

    try {
      createPurchase(id, vencedor.bidder_id, d.valor, fmtTaxa(vencedor.taxa_am), Math.round(d.valor - vencedor.preco));
      settlePurchase({
        duplicataId: id,
        sacadoNome: d.sacado_nome,
        investorId: vencedor.bidder_id,
        cedenteId: d.cedente_id,
        valor: d.valor,
        precoCompra: vencedor.preco,
      });
      // Res. BCB nº 540/2025 — mesma chamada que o caminho de compra fazia.
      void informarNegociacao({
        registradoraKey: d.registradora as RegistradoraKey | null,
        duplicataId: id,
        evento: 'compra',
        valor: vencedor.preco,
      });
      if (d.cedente_id) {
        void deliverWebhookEvent(d.cedente_id, 'pagamento.confirmado', { duplicataId: id, valor: d.valor, investorId: vencedor.bidder_id });
        addNotification(d.cedente_id, `Leilão de ${d.sacado_nome} arrematado a ${fmtTaxa(vencedor.taxa_am)} a.m. — ${fmtBRL(vencedor.preco)} liberados.`, COLORS.GREEN, 'leilao');
      }
      // Se quem venceu foi a conta de sistema do Fundo de Fomento, é aqui que o pool é
      // debitado e o limite do programa consumido — propor um lance não move dinheiro.
      if (vencedor.bidder_id === getFundoSistemaUserIdIfExists()) settleFundoWin(id, vencedor.preco);
      addNotification(vencedor.bidder_id, `Você arrematou ${d.sacado_nome} a ${fmtTaxa(vencedor.taxa_am)} a.m. por ${fmtBRL(vencedor.preco)}.`, COLORS.GREEN, 'leilao');
      for (const p of perdedores) {
        addNotification(p.bidder_id, `Seu lance em ${d.sacado_nome} não venceu — arrematada a ${fmtTaxa(vencedor.taxa_am)} a.m.`, COLORS.AMBER, 'leilao');
      }
      recordAuditEvent(null, 'Leilão', 'leilao.adjudicado', {
        duplicataId: id,
        vencedorId: vencedor.bidder_id,
        taxaAm: vencedor.taxa_am,
        preco: vencedor.preco,
        concorrentes: bids.length,
      });
      vendidos++;
    } catch (err) {
      logger.error({ err, duplicataId: id }, '[leilao] falha ao liquidar o vencedor');
    }
  }

  return { fechados: due.length, vendidos, semLance };
}

// Só iniciado por src/index.ts (o processo real do servidor), mesmo padrão de
// startAceiteTacitoJob — importar app.ts em teste nunca sobe um timer de fundo.
export function startAuctionCloseJob(intervalMs = 30_000): NodeJS.Timeout {
  closeDueAuctions();
  return setInterval(() => closeDueAuctions(), intervalMs);
}
