import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { SACADOS } from '../data/seed.js';
import { buildRiscoView, findSacadoByName } from '../lib/riscoCore.js';

export const riscoRouter = Router();
riscoRouter.use(requireAuth);

riscoRouter.get('/search', (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
  if (!q) {
    res.json({ suggestions: [] });
    return;
  }
  const suggestions = Object.keys(SACADOS).filter((n) => n.toLowerCase().includes(q)).slice(0, 5);
  res.json({ suggestions });
});

riscoRouter.get('/:name', (req, res) => {
  const name = decodeURIComponent(req.params.name);
  const found = findSacadoByName(name);
  if (!found) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  res.json(buildRiscoView(found.name, found.sacado));
});
