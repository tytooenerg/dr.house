import { Router } from 'express';
import * as actions from '../store/actions.js';
import { state } from '../store/state.js';

export const profileRouter = Router();

function payload() {
  return {
    profileForm: state.profileForm,
    notifPrefs: state.notifPrefs,
    teamMembers: state.teamMembers,
  };
}

profileRouter.get('/', (_req, res) => res.json(payload()));

profileRouter.post('/field', (req, res) => {
  actions.updateProfileForm(req.body.field, req.body.value);
  res.json(payload());
});

profileRouter.post('/notif-pref', (req, res) => {
  actions.toggleNotifPref(req.body.key);
  res.json(payload());
});

profileRouter.post('/team/invite', (req, res) => {
  actions.inviteMember(req.body.nome, req.body.email);
  res.json(payload());
});
