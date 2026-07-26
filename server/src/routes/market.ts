import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import { listMarketplace, getDuplicata, setInsurer, createPurchase, isPurchased } from '../db/duplicatas.js';
import { getAceiteByDuplicata } from '../db/aceites.js';
import { buildOfferView } from '../lib/marketCompute.js';
import { deliverWebhookEvent } from '../lib/webhookDelivery.js';

export const marketRouter = Router();
marketRouter.use(requireAuth);

marketRouter.get('/', (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
  const sort = typeof req.query.sort === 'string' ? req.query.sort : 'taxa';
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));

  let offers = listMarketplace().map(buildOfferView);
  if (q) offers = offers.filter((o) => o.sacado.toLowerCase().includes(q) || o.cedente.toLowerCase().includes(q));

  if (sort === 'taxa') offers.sort((a, b) => parseFloat(a.desagio) - parseFloat(b.desagio));
  else if (sort === 'score') offers.sort((a, b) => b.score - a.score);
  else if (sort === 'valor') offers.sort((a, b) => b.valor - a.valor);
  else if (sort === 'prazo') offers.sort((a, b) => a.countdownSec - b.countdownSec);

  const total = offers.length;
  const paged = offers.slice((page - 1) * pageSize, page * pageSize);

  res.json({ offers: paged, page, pageSize, total });
});

marketRouter.post('/:id/buy', (req, res) => {
  if (req.user!.role !== 'investidor') {
    res.status(403).json({ error: 'forbidden', message: 'Apenas contas de investidor podem comprar duplicatas.' });
    return;
  }
  if (req.user!.kyb_status !== 'approved') {
    res.status(403).json({ error: 'kyb_required', message: 'Seu credenciamento institucional ainda está em análise — assim que for aprovado você poderá dar lances.' });
    return;
  }
  const d = getDuplicata(req.params.id);
  if (!d) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  const aceite = getAceiteByDuplicata(d.id);
  if (aceite?.status === 'contestada') {
    res.status(409).json({ error: 'contested', message: 'Esta duplicata está contestada e não pode ser comprada.' });
    return;
  }
  if (isPurchased(d.id)) {
    res.status(409).json({ error: 'already_purchased', message: 'Esta duplicata já foi comprada.' });
    return;
  }
  createPurchase(d.id, req.user!.id, d.valor, d.desagio ?? '');
  if (d.cedente_id) {
    void deliverWebhookEvent(d.cedente_id, 'pagamento.confirmado', { duplicataId: d.id, valor: d.valor, investorId: req.user!.id });
  }
  res.json({ offers: listMarketplace().map(buildOfferView) });
});

const insureSchema = z.object({ key: z.enum(['too', 'pottencial', 'junto']).nullable() });

marketRouter.post('/:id/insure', (req, res) => {
  const parsed = insureSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
    return;
  }
  const d = getDuplicata(req.params.id);
  if (!d) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  setInsurer(d.id, parsed.data.key);
  res.json({ offers: listMarketplace().map(buildOfferView) });
});
