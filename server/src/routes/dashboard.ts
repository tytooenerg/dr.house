import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { listAllDuplicatas } from '../db/duplicatas.js';
import { buildDashboard } from '../lib/dashboardCore.js';

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

// Toda a montagem vive em lib/dashboardCore.ts (padrão de 3 camadas): esta rota só resolve
// o usuário e devolve a visão do papel dele. A lista completa de duplicatas só é lida pra
// visão de plataforma (papéis sem carteira própria) — os outros papéis fazem suas próprias
// consultas escopadas lá dentro.
dashboardRouter.get('/', (req, res) => {
  const user = req.user!;
  const precisaDaPlataforma = user.role !== 'investidor' && user.role !== 'cedente' && user.role !== 'sacado';
  res.json(buildDashboard(user, precisaDaPlataforma ? listAllDuplicatas() : []));
});
