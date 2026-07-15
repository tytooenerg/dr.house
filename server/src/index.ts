import express from 'express';
import cors from 'cors';
import { sessionRouter } from './routes/session.js';
import {
  aceiteRouter, dashboardRouter, disputaRouter, emitirRouter, historicoRouter,
  marketRouter, minhasRouter, notificationsRouter, riscoRouter,
} from './routes/market.js';
import { automationRouter, comparadorRouter } from './routes/automation.js';
import { erpRouter } from './routes/erp.js';
import { complianceRouter } from './routes/compliance.js';
import { devRouter } from './routes/dev.js';
import { profileRouter } from './routes/profile.js';
import { accountRouter, revenueRouter } from './routes/account.js';
import { chatRouter } from './routes/chat.js';

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;

app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'lastro-api' }));

app.use('/api/session', sessionRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/market', marketRouter);
app.use('/api/minhas', minhasRouter);
app.use('/api/historico', historicoRouter);
app.use('/api/emitir', emitirRouter);
app.use('/api/aceites', aceiteRouter);
app.use('/api/disputas', disputaRouter);
app.use('/api/risco', riscoRouter);
app.use('/api/automacao', automationRouter);
app.use('/api/comparador', comparadorRouter);
app.use('/api/erp', erpRouter);
app.use('/api/compliance', complianceRouter);
app.use('/api/dev', devRouter);
app.use('/api/profile', profileRouter);
app.use('/api/account', accountRouter);
app.use('/api/revenue', revenueRouter);
app.use('/api/chat', chatRouter);

app.use((req, res) => {
  res.status(404).json({ error: 'not_found', path: req.path });
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'internal_error' });
});

app.listen(PORT, () => {
  console.log(`Lastro API listening on http://localhost:${PORT}`);
});
