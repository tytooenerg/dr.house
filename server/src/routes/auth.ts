import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import {
  createUser,
  getSettings,
  getUserByEmail,
  getUserById,
  submitKybForReview,
  updateKybForm,
  updateSettings,
} from '../db/users.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { generateRefreshToken, hashRefreshToken, signAccessToken } from '../auth/jwt.js';
import { createRefreshToken, findValidRefreshToken, revokeAllRefreshTokensForUser, revokeRefreshToken } from '../db/refreshTokens.js';
import { requireAuth } from '../auth/middleware.js';
import { recordAuditEvent } from '../db/audit.js';
import { KYB_TIPOS, ONBOARDING_STEPS, ROLE_TABS } from '../data/seed.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import type { UserRow } from '../db/types.js';

export const authRouter = Router();

// Only guards the credential-guessable endpoints — /me, /refresh etc. are hit
// automatically and often, and rate-limiting those would just break active sessions.
const bruteForceLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => !!process.env.VITEST,
  message: { error: 'rate_limited', message: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' },
});

const registerSchema = z.object({
  nome: z.string().trim().min(2, 'Informe seu nome completo.'),
  email: z.string().trim().email('E-mail inválido.'),
  password: z.string().min(6, 'A senha precisa ter ao menos 6 caracteres.'),
  companyName: z.string().trim().min(2, 'Informe o nome da empresa.'),
  role: z.enum(['investidor', 'cedente', 'sacado']),
});

const loginSchema = z.object({
  email: z.string().trim().email('E-mail inválido.'),
  password: z.string().min(1, 'Informe sua senha.'),
});

function publicUser(user: UserRow) {
  const settings = getSettings(user);
  const steps = ONBOARDING_STEPS[user.role as 'investidor' | 'cedente' | 'sacado'] ?? [];
  const onboardingSeen = settings.onboardingSeen;
  return {
    id: user.id,
    email: user.email,
    nome: user.nome,
    telefone: user.telefone,
    companyName: user.company_name,
    role: user.role,
    kybDone: !!user.kyb_done,
    kybForm: JSON.parse(user.kyb_form || '{}'),
    kybTipoOptions: KYB_TIPOS,
    kybStatus: user.kyb_status,
    kybRejectReason: user.kyb_reject_reason,
    needsKyb: user.role === 'investidor' && (user.kyb_status === 'none' || user.kyb_status === 'rejected'),
    kybPending: user.role === 'investidor' && user.kyb_status === 'pending',
    showOnboarding: !onboardingSeen,
    onboardingSteps: steps,
    sessionLabel: user.role === 'sacado' ? 'Sessão Sacado' : user.role === 'cedente' ? 'Sessão Cedente' : user.role === 'admin' ? 'Back-office' : 'Conta Investidor',
    navTabs: ROLE_TABS[user.role as 'investidor' | 'cedente' | 'sacado'] ?? [],
  };
}

function issueTokens(user: UserRow) {
  const accessToken = signAccessToken({ sub: user.id, role: user.role });
  const refreshToken = generateRefreshToken();
  createRefreshToken(user.id, hashRefreshToken(refreshToken));
  return { accessToken, refreshToken };
}

authRouter.post(
  '/register',
  bruteForceLimiter,
  asyncHandler(async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    const { nome, email, password, companyName, role } = parsed.data;
    if (getUserByEmail(email)) {
      res.status(409).json({ error: 'email_taken', message: 'Já existe uma conta com este e-mail.' });
      return;
    }
    const passwordHash = await hashPassword(password);
    const user = createUser({ email, passwordHash, nome, companyName, role });
    const { accessToken, refreshToken } = issueTokens(user);
    recordAuditEvent(user.id, user.company_name, 'user.registered', { role });
    res.status(201).json({ token: accessToken, refreshToken, user: publicUser(user) });
  })
);

authRouter.post(
  '/login',
  bruteForceLimiter,
  asyncHandler(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    const user = getUserByEmail(parsed.data.email);
    if (!user || !(await verifyPassword(parsed.data.password, user.password_hash))) {
      res.status(401).json({ error: 'invalid_credentials', message: 'E-mail ou senha incorretos.' });
      return;
    }
    const { accessToken, refreshToken } = issueTokens(user);
    recordAuditEvent(user.id, user.company_name, 'user.login', {});
    res.json({ token: accessToken, refreshToken, user: publicUser(user) });
  })
);

const refreshSchema = z.object({ refreshToken: z.string().min(1) });

authRouter.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const parsed = refreshSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    const tokenHash = hashRefreshToken(parsed.data.refreshToken);
    const record = findValidRefreshToken(tokenHash);
    if (!record) {
      res.status(401).json({ error: 'unauthorized', message: 'Sessão expirada — faça login novamente.' });
      return;
    }
    const user = getUserById(record.user_id);
    if (!user) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    // Rotate: the old refresh token is single-use, so a leaked-but-already-used token is inert.
    revokeRefreshToken(tokenHash);
    const { accessToken, refreshToken } = issueTokens(user);
    res.json({ token: accessToken, refreshToken });
  })
);

authRouter.post('/logout', requireAuth, (req, res) => {
  const body = z.object({ refreshToken: z.string().optional() }).safeParse(req.body);
  if (body.success && body.data.refreshToken) revokeRefreshToken(hashRefreshToken(body.data.refreshToken));
  else revokeAllRefreshTokensForUser(req.user!.id);
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user!) });
});

const kybSchema = z.object({
  cnpj: z.string().trim().min(1).optional().default(''),
  tipo: z.enum(KYB_TIPOS as [string, ...string[]]).optional(),
  pl: z.string().trim().optional().default(''),
});

authRouter.post('/kyb', requireAuth, (req, res) => {
  const parsed = kybSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
    return;
  }
  const userId = req.user!.id;
  if (parsed.data.cnpj) updateKybForm(userId, 'cnpj', parsed.data.cnpj);
  if (parsed.data.tipo) updateKybForm(userId, 'tipo', parsed.data.tipo);
  if (parsed.data.pl) updateKybForm(userId, 'pl', parsed.data.pl);
  submitKybForReview(userId);
  recordAuditEvent(userId, req.user!.company_name, 'kyb.submitted', { cnpj: parsed.data.cnpj });
  const refreshed = getUserById(userId)!;
  res.json({ user: publicUser(refreshed) });
});

authRouter.post('/onboarding/complete', requireAuth, (req, res) => {
  updateSettings(req.user!.id, { onboardingSeen: true });
  res.json({ ok: true });
});
