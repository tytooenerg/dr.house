import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import { getSettings, updateProfile, updateSettings } from '../db/users.js';
import { inviteTeamMember, listTeam } from '../db/misc.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { twilioEnabled } from '../lib/smsNotifier.js';

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

const notifPrefSchema = z.object({ key: z.enum(['leilao', 'aceite', 'disputa', 'marketing']) });

profileRouter.post('/notif-pref', (req, res) => {
  const parsed = notifPrefSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
    return;
  }
  const settings = getSettings(req.user!);
  updateSettings(req.user!.id, { notifPrefs: { ...settings.notifPrefs, [parsed.data.key]: !settings.notifPrefs[parsed.data.key] } });
  res.json(payload(req));
});

profileRouter.post('/notify-whatsapp-toggle', (req, res) => {
  const settings = getSettings(req.user!);
  updateSettings(req.user!.id, { notifyViaWhatsapp: !settings.notifyViaWhatsapp });
  res.json(payload(req));
});

const inviteSchema = z.object({ nome: z.string().trim().min(2), email: z.string().trim().email() });

profileRouter.post('/team/invite', (req, res) => {
  const parsed = inviteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
    return;
  }
  inviteTeamMember(req.user!.id, parsed.data.nome, parsed.data.email);
  res.json(payload(req));
});
