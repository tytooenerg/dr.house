import { Router } from 'express';
import { z } from 'zod';
import { createUser, getSettings, getUserByEmail, markKybDone, updateKybForm, updateSettings } from '../db/users.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { signToken } from '../auth/jwt.js';
import { requireAuth } from '../auth/middleware.js';
import { KYB_TIPOS, ONBOARDING_STEPS, ROLE_TABS } from '../data/seed.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import type { UserRow } from '../db/types.js';

export const authRouter = Router();

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
  const steps = ONBOARDING_STEPS[user.role];
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
    needsKyb: user.role === 'investidor' && !user.kyb_done,
    showOnboarding: !onboardingSeen,
    onboardingSteps: steps,
    sessionLabel: user.role === 'sacado' ? 'Sessão Sacado' : user.role === 'cedente' ? 'Sessão Cedente' : 'Conta Investidor',
    navTabs: ROLE_TABS[user.role],
  };
}

authRouter.post(
  '/register',
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
    const token = signToken({ sub: user.id, role: user.role });
    res.status(201).json({ token, user: publicUser(user) });
  })
);

authRouter.post(
  '/login',
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
    const token = signToken({ sub: user.id, role: user.role });
    res.json({ token, user: publicUser(user) });
  })
);

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
  markKybDone(userId);
  const refreshed = { ...req.user!, kyb_done: 1 };
  res.json({ user: publicUser(refreshed) });
});

authRouter.post('/onboarding/complete', requireAuth, (req, res) => {
  updateSettings(req.user!.id, { onboardingSeen: true });
  res.json({ ok: true });
});
