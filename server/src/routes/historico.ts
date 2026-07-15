import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { listPurchasesByInvestor } from '../db/duplicatas.js';
import { fmtBRL, toIsoUtc } from '../lib/format.js';

export const historicoRouter = Router();
historicoRouter.use(requireAuth);

historicoRouter.get('/', (req, res) => {
  const purchases = listPurchasesByInvestor(req.user!.id);
  const totalInvestido = purchases.reduce((sum, p) => sum + p.valor, 0);
  const totalRetorno = purchases.reduce((sum, p) => sum + p.retorno, 0);
  const rentMedia = totalInvestido > 0 ? (totalRetorno / totalInvestido) * 100 : 0;

  res.json({
    totalInvestidoFmt: fmtBRL(totalInvestido),
    retornoAcumuladoFmt: '+' + fmtBRL(totalRetorno),
    rentabilidadeMediaFmt: rentMedia.toFixed(1).replace('.', ',') + '% a.m.',
    historico: purchases.map((p) => ({
      data: new Date(toIsoUtc(p.created_at)).toLocaleDateString('pt-BR'),
      empresa: p.sacado_nome,
      investidoFmt: fmtBRL(p.valor),
      retornoFmt: '+' + fmtBRL(p.retorno),
      status: 'Concluída',
    })),
  });
});
