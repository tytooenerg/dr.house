import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './db/index.js';
import { httpLogger, logger } from './lib/logger.js';
import { captureError } from './lib/sentry.js';
import { adminRouter } from './routes/admin.js';

import { authRouter } from './routes/auth.js';
import { dashboardRouter } from './routes/dashboard.js';
import { notificationsRouter } from './routes/notifications.js';
import { marketRouter } from './routes/market.js';
import { minhasRouter } from './routes/minhas.js';
import { historicoRouter } from './routes/historico.js';
import { emitirRouter } from './routes/emitir.js';
import { aceiteRouter } from './routes/aceites.js';
import { disputaRouter } from './routes/disputas.js';
import { riscoRouter } from './routes/risco.js';
import { automationRouter } from './routes/automation.js';
import { comparadorRouter } from './routes/comparador.js';
import { erpRouter } from './routes/erp.js';
import { complianceRouter } from './routes/compliance.js';
import { devRouter } from './routes/dev.js';
import { profileRouter } from './routes/profile.js';
import { accountRouter, revenueRouter } from './routes/account.js';
import { chatRouter } from './routes/chat.js';
import { uploadsRouter } from './routes/uploads.js';
import { billingRouter, handleStripeWebhook } from './routes/billing.js';
import { seguradoraRouter } from './routes/seguradora.js';
import { v1Router } from './routes/v1.js';

export const app = express();

const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  helmet({
    contentSecurityPolicy: false, // the SPA is served separately by Vite/static hosting, not by this API
  })
);
// Scoped to /api only — static asset requests carry an Origin header too (the built
// SPA's <script crossorigin> tags trigger CORS mode even when same-origin), and those
// must never be rejected just because CORS_ORIGINS doesn't happen to list this server's
// own origin.
const strictCors = cors({
  origin(origin, callback) {
    // no Origin header (curl, server-to-server, same-origin) is allowed through
    if (!origin || allowedOrigins.includes(origin)) callback(null, true);
    else callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
});
// /api/v1/* is the public partner API — authenticated by API key, not cookies/JWT, so
// it's meant to be called cross-origin from any partner's own domain/server and gets an
// open CORS policy instead of the SPA-only allowlist.
const openCors = cors();
app.use('/api', (req, res, next) => (req.path.startsWith('/v1/') ? openCors(req, res, next) : strictCors(req, res, next)));
// Stripe webhook signature verification needs the exact raw body, so it must be
// registered with its own raw parser before the global express.json() below.
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), handleStripeWebhook);

app.use(express.json());
if (!process.env.VITEST) app.use(httpLogger);

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'lastro-api' }));

app.use('/api/auth', authRouter);
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
app.use('/api/uploads', uploadsRouter);
app.use('/api/admin', adminRouter);
app.use('/api/billing', billingRouter);
app.use('/api/seguradora', seguradoraRouter);
app.use('/api/v1', v1Router);

// In production (Docker), this server also serves the built SPA — dev mode uses the
// Vite dev server + proxy instead, so client/dist won't exist and this is skipped.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = process.env.CLIENT_DIST_PATH || path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^(?!\/api|\/ws).*/, (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

app.use((req, res) => {
  res.status(404).json({ error: 'not_found', path: req.path });
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err }, 'unhandled request error');
  captureError(err);
  res.status(500).json({ error: 'internal_error' });
});
