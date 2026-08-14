import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import { getSettings, getUserById, updateProfile, updateSettings } from '../db/users.js';
import { inviteTeamMember, listTeam, revokeTeamMember } from '../db/misc.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { twilioEnabled } from '../lib/smsNotifier.js';
import { sendEmail } from '../lib/mailer.js';
import { recordAuditEvent } from '../db/audit.js';

// Base URL the SPA is actually served from — used to build the accept-invite link
// mailed to the invitee. Defaults to the Vite dev server since that's how this app is
// normally run locally.
const APP_URL = process.env.APP_URL || 'http://localhost:5173';

export const profileRouter = Router();
profileRouter.use(requireAuth);

function payloadForUser(user: import('../db/types.js').UserRow) {
  const settings = getSettings(user);
  return {
    profileForm: { nome: user.nome, email: user.email, telefone: user.telefone },
    notifPrefs: settings.notifPrefs,
    notifyViaWhatsapp: settings.notifyViaWhatsapp,
    whatsappEnabled: twilioEnabled,
    teamMembers: listTeam(user.id),
  };
}

function payload(req: import('express').Request) {
  return payloadForUser(req.user!);
}

profileRouter.get('/', (req, res) => res.json(payload(req)));

const fieldSchema = z.object({ field: z.enum(['nome', 'email', 'telefone']), value: z.string().trim() });

profileRouter.post(
  '/field',
  asyncHandler(async (req, res) => {
    const parsed = fieldSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    if (parsed.data.field === 'email' && !parsed.data.value.includes('@')) {
      res.status(400).json({ error: 'validation_error', message: 'E-mail inválido.' });
      return;
    }
    const updated = updateProfile(req.user!.id, { [parsed.data.field]: parsed.data.value });
    res.json(payloadForUser(updated));
  })
);

const notifPrefSchema = z.object({ key: z.enum(['leilao', 'aceite', 'disputa', 'marketing', 'digest']) });

profileRouter.post('/notif-pref', (req, res) => {
  const parsed = notifPrefSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
    return;
  }
  const settings = getSettings(req.user!);
  updateSettings(req.user!.id, { notifPrefs: { ...settings.notifPrefs, [parsed.data.key]: !settings.notifPrefs[parsed.data.key] } });
  // req.user! was read once at the top of the request pipeline (requireAuth), before the
  // write above — building the response from it would echo back the pre-toggle value
  // instead of the one that was just saved. Re-read the row so the response (and the
  // client state PerfilPage.tsx sets directly from it) reflects what's actually on disk.
  res.json(payloadForUser(getUserById(req.user!.id)!));
});

profileRouter.post('/notify-whatsapp-toggle', (req, res) => {
  const settings = getSettings(req.user!);
  updateSettings(req.user!.id, { notifyViaWhatsapp: !settings.notifyViaWhatsapp });
  res.json(payloadForUser(getUserById(req.user!.id)!));
});

const inviteSchema = z.object({ nome: z.string().trim().min(2), email: z.string().trim().email() });

// Real invite: a single-use token is generated (db/misc.ts only ever stores its hash),
// mailed to the invitee as an accept link, and returned in the response too so the owner
// can copy/share it directly when SMTP isn't configured — same "logged instead of sent,
// but still usable" pattern every other notification in this app follows.
profileRouter.post('/team/invite', (req, res) => {
  const parsed = inviteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
    return;
  }
  const { token } = inviteTeamMember(req.user!.id, parsed.data.nome, parsed.data.email);
  const inviteUrl = `${APP_URL}/convite-equipe?token=${token}`;
  sendEmail(
    parsed.data.email,
    `${req.user!.company_name} convidou você para a Lastro`,
    `${req.user!.nome} convidou você para acessar a conta de ${req.user!.company_name} na Lastro (acesso somente leitura a Dashboard, Minhas Duplicatas, Histórico e Receita).\n\nAceite o convite e crie sua senha: ${inviteUrl}\n\nEste link expira em 7 dias.`
  );
  recordAuditEvent(req.user!.id, req.user!.company_name, 'team.invited', { email: parsed.data.email });
  res.json({ ...payload(req), inviteUrl });
});

profileRouter.post(
  '/team/:id/revoke',
  asyncHandler(async (req, res) => {
    revokeTeamMember(req.user!.id, Number(req.params.id));
    recordAuditEvent(req.user!.id, req.user!.company_name, 'team.revoked', { teamMemberId: Number(req.params.id) });
    res.json(payload(req));
  })
);
