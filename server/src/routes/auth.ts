import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import {
  createUser,
  getSettings,
  getUserByEmail,
  getUserById,
  getUserByGoogleSub,
  linkGoogleAccount,
  submitKybForReview,
  updateKybForm,
  updateSettings,
  approveKyb,
} from '../db/users.js';
import { acceptTeamInvite, findTeamInviteByToken } from '../db/misc.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import {
  generateRefreshToken,
  hashRefreshToken,
  signAccessToken,
  signChallengeToken,
  verifyChallengeToken,
  signGoogleOAuthState,
  verifyGoogleOAuthState,
  signGoogleSignupToken,
  verifyGoogleSignupToken,
} from '../auth/jwt.js';
import { googleOAuthEnabled, buildGoogleAuthUrl, exchangeCodeForProfile } from '../lib/googleOAuth.js';
import crypto from 'node:crypto';
import { createRefreshToken, findValidRefreshToken, revokeAllRefreshTokensForUser, revokeRefreshToken } from '../db/refreshTokens.js';
import { requireAuth } from '../auth/middleware.js';
import { recordAuditEvent } from '../db/audit.js';
import { INSURERS, KYB_TIPOS, ONBOARDING_STEPS, ROLE_TABS } from '../data/seed.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { runPldScreening } from '../lib/pldScreening.js';
import { runAgent } from '../lib/agentRuntime.js';
import { onboardingAgent } from '../lib/agents/onboarding.js';
import { claudeEnabled } from '../lib/claude.js';
import { aiFeatureLimiter } from '../lib/aiRateLimit.js';
import { generateTotpSecret, verifyTotp, otpauthUrl, generateRecoveryCode } from '../lib/totp.js';
import { setTotpSecret, enableTotp, disableTotp, storeRecoveryCodes, consumeRecoveryCode, countRemainingRecoveryCodes } from '../db/twoFactor.js';
import { logger } from '../lib/logger.js';
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
  role: z.enum(['investidor', 'cedente', 'sacado', 'seguradora']),
  insurerKey: z
    .enum(INSURERS.map((i) => i.key) as [string, ...string[]])
    .optional(),
  referralCode: z.string().trim().optional(),
});

const loginSchema = z.object({
  email: z.string().trim().email('E-mail inválido.'),
  password: z.string().min(1, 'Informe sua senha.'),
});

// Mirrors the read-only route scope enforced server-side in auth/middleware.ts — a team
// member's nav only ever shows tabs they can actually open, instead of the owner's full
// nav with most of it 403ing on click.
const TEAM_MEMBER_ALLOWED_TABS = ['dashboard', 'minhas', 'historico', 'receita', 'perfil'];

function publicUser(user: UserRow) {
  const settings = getSettings(user);
  const steps = ONBOARDING_STEPS[user.role] ?? [];
  const onboardingSeen = settings.onboardingSeen;
  const insurer = user.insurer_key ? INSURERS.find((i) => i.key === user.insurer_key) : null;
  const roleTabs = ROLE_TABS[user.role] ?? [];
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
    sessionLabel:
      user.role === 'sacado'
        ? 'Sessão Sacado'
        : user.role === 'cedente'
          ? 'Sessão Cedente'
          : user.role === 'admin'
            ? 'Back-office'
            : user.role === 'seguradora'
              ? 'Seguradora Parceira'
              : 'Conta Investidor',
    navTabs: user.team_owner_id ? roleTabs.filter((t) => TEAM_MEMBER_ALLOWED_TABS.includes(t)) : roleTabs,
    isTeamMember: !!user.team_owner_id,
    totpEnabled: !!user.totp_enabled,
    biometricVerified: settings.biometricVerified,
    plan: user.plan,
    subscriptionStatus: user.subscription_status,
    insurerKey: user.insurer_key,
    insurerName: insurer?.name ?? null,
    pldStatus: user.pld_status,
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
    const { nome, email, password, companyName, role, insurerKey, referralCode } = parsed.data;
    if (role === 'seguradora' && !insurerKey) {
      res.status(400).json({ error: 'validation_error', message: 'Selecione qual seguradora sua conta representa.' });
      return;
    }
    if (getUserByEmail(email)) {
      res.status(409).json({ error: 'email_taken', message: 'Já existe uma conta com este e-mail.' });
      return;
    }
    const passwordHash = await hashPassword(password);
    const user = createUser({ email, passwordHash, nome, companyName, role, insurerKey, referredByCode: referralCode });
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
    // 2FA: password alone isn't enough — hand back a short-lived challenge token instead
    // of real session tokens, exchanged for them by POST /2fa/verify-login once the
    // TOTP/recovery code checks out (see auth/jwt.ts signChallengeToken).
    if (user.totp_enabled) {
      res.json({ twoFactorRequired: true, challengeToken: signChallengeToken(user.id) });
      return;
    }
    const { accessToken, refreshToken } = issueTokens(user);
    recordAuditEvent(user.id, user.company_name, 'user.login', {});
    res.json({ token: accessToken, refreshToken, user: publicUser(user) });
  })
);

const twoFactorVerifySchema = z.object({ challengeToken: z.string().trim().min(10), code: z.string().trim().min(6).max(11) });

// Public — the client isn't authenticated yet at this point (it only has the short-lived
// challenge token from /login, not a real session). Guarded by the same brute-force
// limiter as login since the TOTP code space is small enough to matter.
authRouter.post(
  '/2fa/verify-login',
  bruteForceLimiter,
  asyncHandler(async (req, res) => {
    const parsed = twoFactorVerifySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    const userId = verifyChallengeToken(parsed.data.challengeToken);
    if (!userId) {
      res.status(401).json({ error: 'unauthorized', message: 'Sessão de verificação expirada — faça login novamente.' });
      return;
    }
    const user = getUserById(userId);
    if (!user || !user.totp_enabled || !user.totp_secret) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const ok = verifyTotp(user.totp_secret, parsed.data.code) || consumeRecoveryCode(user.id, parsed.data.code);
    if (!ok) {
      res.status(401).json({ error: 'invalid_code', message: 'Código inválido — verifique o app autenticador ou use um código de recuperação.' });
      return;
    }
    const { accessToken, refreshToken } = issueTokens(user);
    recordAuditEvent(user.id, user.company_name, 'user.login_2fa', {});
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

const APP_URL = process.env.APP_URL || 'http://localhost:5173';

function googleRedirectUri(req: import('express').Request): string {
  return process.env.GOOGLE_OAUTH_REDIRECT_URI || `${req.protocol}://${req.get('host')}/api/auth/google/callback`;
}

// Public — lets the client decide whether to show "Continuar com Google" at all, since
// there's deliberately no simulated fallback for a third-party identity check.
authRouter.get('/google/config', (_req, res) => {
  res.json({ enabled: googleOAuthEnabled });
});

authRouter.get('/google/start', (req, res) => {
  if (!googleOAuthEnabled) {
    res.status(404).json({ error: 'not_configured', message: 'Login com Google não está configurado neste ambiente.' });
    return;
  }
  const referralCode = typeof req.query.ref === 'string' ? req.query.ref : undefined;
  const state = signGoogleOAuthState(referralCode);
  res.redirect(302, buildGoogleAuthUrl(state, googleRedirectUri(req)));
});

authRouter.get(
  '/google/callback',
  asyncHandler(async (req, res) => {
    if (!googleOAuthEnabled) {
      res.redirect(302, `${APP_URL}/?googleError=nao_configurado`);
      return;
    }
    const code = typeof req.query.code === 'string' ? req.query.code : null;
    const stateToken = typeof req.query.state === 'string' ? req.query.state : null;
    const state = stateToken ? verifyGoogleOAuthState(stateToken) : null;
    if (!code || !state) {
      res.redirect(302, `${APP_URL}/?googleError=sessao_invalida`);
      return;
    }
    let profile;
    try {
      profile = await exchangeCodeForProfile(code, googleRedirectUri(req));
    } catch (err) {
      logger.error({ err }, '[google-oauth] falha ao trocar código pelo perfil');
      res.redirect(302, `${APP_URL}/?googleError=falha_google`);
      return;
    }
    if (!profile.emailVerified) {
      res.redirect(302, `${APP_URL}/?googleError=email_nao_verificado`);
      return;
    }

    const byGoogleSub = getUserByGoogleSub(profile.sub);
    if (byGoogleSub) {
      const { accessToken, refreshToken } = issueTokens(byGoogleSub);
      recordAuditEvent(byGoogleSub.id, byGoogleSub.company_name, 'user.login_google', {});
      res.redirect(302, `${APP_URL}/oauth/callback?token=${encodeURIComponent(accessToken)}&refreshToken=${encodeURIComponent(refreshToken)}`);
      return;
    }

    const byEmail = getUserByEmail(profile.email);
    if (byEmail) {
      // Account linking: the same verified email already has a password-based Lastro
      // account — attach this Google identity to it rather than creating a duplicate.
      linkGoogleAccount(byEmail.id, profile.sub);
      const { accessToken, refreshToken } = issueTokens(byEmail);
      recordAuditEvent(byEmail.id, byEmail.company_name, 'user.google_linked', {});
      res.redirect(302, `${APP_URL}/oauth/callback?token=${encodeURIComponent(accessToken)}&refreshToken=${encodeURIComponent(refreshToken)}`);
      return;
    }

    // Brand new email — can't create the account yet (role/companyName still needed), so
    // hand the client a short-lived, Google-verified signup token instead.
    const signupToken = signGoogleSignupToken({ email: profile.email, nome: profile.name, googleSub: profile.sub, referralCode: state.referralCode });
    res.redirect(
      302,
      `${APP_URL}/completar-cadastro-google?signupToken=${encodeURIComponent(signupToken)}&nome=${encodeURIComponent(profile.name)}&email=${encodeURIComponent(profile.email)}`
    );
  })
);

const completeGoogleSignupSchema = z.object({
  signupToken: z.string().trim().min(10),
  companyName: z.string().trim().min(2, 'Informe o nome da empresa.'),
  role: z.enum(['investidor', 'cedente', 'sacado', 'seguradora']),
  insurerKey: z.enum(INSURERS.map((i) => i.key) as [string, ...string[]]).optional(),
});

authRouter.post(
  '/google/complete-signup',
  bruteForceLimiter,
  asyncHandler(async (req, res) => {
    const parsed = completeGoogleSignupSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    const { companyName, role, insurerKey } = parsed.data;
    if (role === 'seguradora' && !insurerKey) {
      res.status(400).json({ error: 'validation_error', message: 'Selecione qual seguradora sua conta representa.' });
      return;
    }
    const payload = verifyGoogleSignupToken(parsed.data.signupToken);
    if (!payload) {
      res.status(401).json({ error: 'unauthorized', message: 'Sessão de cadastro via Google expirada — tente novamente.' });
      return;
    }
    // The token itself proves Google already verified this email; re-check it hasn't
    // been claimed (by a normal registration or a concurrent Google signup) meanwhile.
    if (getUserByEmail(payload.email) || getUserByGoogleSub(payload.googleSub)) {
      res.status(409).json({ error: 'email_taken', message: 'Já existe uma conta com este e-mail.' });
      return;
    }
    // Google-only accounts still get a real password_hash — a random, never-revealed
    // value bcrypt-hashed the normal way, so verifyPassword can never match it. Avoids
    // relaxing password_hash to nullable across every other read of that column.
    const randomPasswordHash = await hashPassword(crypto.randomBytes(24).toString('hex'));
    const user = createUser({
      email: payload.email,
      passwordHash: randomPasswordHash,
      nome: payload.nome || companyName,
      companyName,
      role,
      insurerKey,
      referredByCode: payload.referralCode ?? undefined,
      googleSub: payload.googleSub,
    });
    const { accessToken, refreshToken } = issueTokens(user);
    recordAuditEvent(user.id, user.company_name, 'user.registered_google', { role });
    res.status(201).json({ token: accessToken, refreshToken, user: publicUser(user) });
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
  // Non-resident investor (INR) fields — see lib/foreignInvestorCompliance.ts. CNPJ
  // doesn't apply to a foreign entity, so naoResidente=true swaps it for a foreign tax ID
  // on the client; taxIdEstrangeiro is screened against sanctions lists the same way cnpj
  // would be, just without the Brazilian-format check.
  naoResidente: z.boolean().optional().default(false),
  paisDomicilio: z.string().trim().max(80).optional().default(''),
  taxIdEstrangeiro: z.string().trim().max(60).optional().default(''),
  representanteLegal: z.string().trim().max(140).optional().default(''),
});

authRouter.post(
  '/kyb',
  requireAuth,
  aiFeatureLimiter,
  asyncHandler(async (req, res) => {
    const parsed = kybSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    const userId = req.user!.id;
    if (parsed.data.cnpj) updateKybForm(userId, 'cnpj', parsed.data.cnpj);
    if (parsed.data.tipo) updateKybForm(userId, 'tipo', parsed.data.tipo);
    if (parsed.data.pl) updateKybForm(userId, 'pl', parsed.data.pl);
    updateKybForm(userId, 'naoResidente', parsed.data.naoResidente ? '1' : '');
    if (parsed.data.paisDomicilio) updateKybForm(userId, 'paisDomicilio', parsed.data.paisDomicilio);
    if (parsed.data.taxIdEstrangeiro) updateKybForm(userId, 'taxIdEstrangeiro', parsed.data.taxIdEstrangeiro);
    if (parsed.data.representanteLegal) updateKybForm(userId, 'representanteLegal', parsed.data.representanteLegal);
    submitKybForReview(userId);
    recordAuditEvent(userId, req.user!.company_name, 'kyb.submitted', { cnpj: parsed.data.cnpj, naoResidente: parsed.data.naoResidente });
    const screeningId = parsed.data.naoResidente ? parsed.data.taxIdEstrangeiro : parsed.data.cnpj;
    await runPldScreening(userId, req.user!.company_name, screeningId);

    // Pre-triage, fire-and-forget: the Onboarding agent investigates this account (sanções,
    // histórico judicial) in the background so the admin KYB queue can show a ready
    // recommendation instead of the admin starting from zero. Never blocks the response,
    // never itself approves/rejects — aprovar_kyb/rejeitar_kyb stay sensitive/gated exactly
    // like a manually-triggered run. A no-op (not even a wasted "simulado" row) when
    // ANTHROPIC_API_KEY isn't configured, same discipline as every other agent job.
    if (claudeEnabled) {
      void runAgent(onboardingAgent, {
        input: `Uma empresa acabou de submeter o KYB para análise (userId=${userId}). Investigue sanções/PEP e histórico judicial e recomende aprovar ou rejeitar, com evidências concretas.`,
        subjectType: 'user',
        subjectId: String(userId),
      }).catch((err) => logger.warn({ err, userId }, '[onboarding-agent] falha na pré-triagem automática'));
    }

    const refreshed = getUserById(userId)!;
    res.json({ user: publicUser(refreshed) });
  })
);

authRouter.post('/onboarding/complete', requireAuth, (req, res) => {
  updateSettings(req.user!.id, { onboardingSeen: true });
  res.json({ ok: true });
});

// Generates a new secret and returns it for the user to add to their authenticator app —
// totp_enabled stays 0 until /2fa/confirm proves they actually captured it, so an
// abandoned setup never locks the account out of normal password-only login.
authRouter.post('/2fa/setup', requireAuth, (req, res) => {
  const secret = generateTotpSecret();
  setTotpSecret(req.user!.id, secret);
  res.json({ secret, otpauthUrl: otpauthUrl(secret, req.user!.email) });
});

const confirm2faSchema = z.object({ code: z.string().trim().length(6) });

authRouter.post('/2fa/confirm', requireAuth, (req, res) => {
  const parsed = confirm2faSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
    return;
  }
  const user = req.user!;
  if (!user.totp_secret) {
    res.status(409).json({ error: 'not_started', message: 'Inicie a configuração em /2fa/setup antes de confirmar.' });
    return;
  }
  if (!verifyTotp(user.totp_secret, parsed.data.code)) {
    res.status(400).json({ error: 'invalid_code', message: 'Código inválido — verifique o horário do seu dispositivo e tente novamente.' });
    return;
  }
  enableTotp(user.id);
  // Recovery codes are shown exactly once, right here — only their hash is ever stored
  // (db/twoFactor.ts), same as every other secret this app handles.
  const recoveryCodes = Array.from({ length: 8 }, () => generateRecoveryCode());
  storeRecoveryCodes(user.id, recoveryCodes);
  recordAuditEvent(user.id, user.company_name, '2fa.enabled', {});
  res.json({ ok: true, recoveryCodes });
});

const disable2faSchema = z.object({ password: z.string().min(1, 'Informe sua senha para confirmar.') });

authRouter.post(
  '/2fa/disable',
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = disable2faSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    const ok = await verifyPassword(parsed.data.password, req.user!.password_hash);
    if (!ok) {
      res.status(401).json({ error: 'invalid_password', message: 'Senha incorreta.' });
      return;
    }
    disableTotp(req.user!.id);
    recordAuditEvent(req.user!.id, req.user!.company_name, '2fa.disabled', {});
    res.json({ ok: true });
  })
);

authRouter.get('/2fa/status', requireAuth, (req, res) => {
  res.json({
    enabled: !!req.user!.totp_enabled,
    remainingRecoveryCodes: req.user!.totp_enabled ? countRemainingRecoveryCodes(req.user!.id) : 0,
  });
});

const teamInviteAcceptSchema = z.object({
  token: z.string().trim().min(10),
  nome: z.string().trim().min(2).optional(),
  password: z.string().min(6, 'A senha precisa ter ao menos 6 caracteres.'),
});

// Public — the invitee doesn't have an account yet. Guarded by the same brute-force
// limiter as login/register since the token itself is the only credential here (see
// db/misc.ts inviteTeamMember, which only ever stores its hash).
authRouter.post(
  '/team-invite/accept',
  bruteForceLimiter,
  asyncHandler(async (req, res) => {
    const parsed = teamInviteAcceptSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    const invite = findTeamInviteByToken(parsed.data.token);
    if (!invite || (invite.invite_expires_at && new Date(invite.invite_expires_at) < new Date())) {
      res.status(400).json({ error: 'invalid_invite', message: 'Convite inválido ou expirado — peça um novo convite.' });
      return;
    }
    const owner = getUserById(invite.owner_id);
    if (!owner) {
      res.status(400).json({ error: 'invalid_invite', message: 'Convite inválido.' });
      return;
    }
    if (getUserByEmail(invite.email)) {
      res.status(409).json({ error: 'email_taken', message: 'Já existe uma conta com este e-mail. Faça login normalmente.' });
      return;
    }
    const passwordHash = await hashPassword(parsed.data.password);
    const user = createUser({
      email: invite.email,
      passwordHash,
      nome: parsed.data.nome?.trim() || invite.nome,
      companyName: owner.company_name,
      role: owner.role,
      insurerKey: owner.insurer_key ?? undefined,
      teamOwnerId: owner.id,
    });
    // The member represents the same company as the owner — if the owner already cleared
    // KYB, the member shouldn't hit that wall again on an account that can't act on
    // anything but reads anyway (see auth/middleware.ts's team-member scope).
    if (owner.role === 'investidor' && owner.kyb_status === 'approved') approveKyb(user.id);
    acceptTeamInvite(invite.id, user.id);
    recordAuditEvent(owner.id, owner.company_name, 'team.invite_accepted', { memberEmail: invite.email });
    const { accessToken, refreshToken } = issueTokens(user);
    res.status(201).json({ token: accessToken, refreshToken, user: publicUser(user) });
  })
);
