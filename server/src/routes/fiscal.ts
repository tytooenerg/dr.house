import { Router } from 'express';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { effectiveOwnerId } from '../db/users.js';
import { buildResumoFiscalCedente } from '../lib/fiscalCedente.js';

export const fiscalRouter = Router();
// O resumo fiscal é do cedente: é ele quem paga o deságio e sofre (ou não) o IOF. O informe
// de rendimentos do investidor já vive em /historico/informe-rendimentos.
fiscalRouter.use(requireAuth, requireRole('cedente'));

fiscalRouter.get('/resumo', (req, res) => {
  const ano = Number(req.query.ano) || new Date().getFullYear();
  res.json(buildResumoFiscalCedente(effectiveOwnerId(req.user!), ano));
});
