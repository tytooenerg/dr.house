import { Router } from 'express';
import { state } from '../store/state.js';
import * as actions from '../store/actions.js';
import { KYB_TIPOS, ONBOARDING_STEPS, ROLE_TABS } from '../data/seed.js';

export const sessionRouter = Router();

function sessionPayload() {
  const role = state.userRole;
  const steps = role ? ONBOARDING_STEPS[role] : ONBOARDING_STEPS.investidor;
  return {
    isLoggedIn: state.isLoggedIn,
    pickedRole: state.pickedRole,
    userRole: state.userRole,
    showKyb: state.showKyb,
    kybStep: state.kybStep,
    kybDone: state.kybDone,
    kybForm: state.kybForm,
    kybTipoOptions: KYB_TIPOS,
    showOnboarding: state.showOnboarding,
    onboardingStep: state.onboardingStep,
    onboardingSteps: steps,
    onboardingCurrent: steps[state.onboardingStep] || steps[0],
    onboardingIsLast: state.onboardingStep >= steps.length - 1,
    sessionLabel: role === 'sacado' ? 'Sessão Sacado' : role === 'cedente' ? 'Sessão Cedente' : 'Conta Investidor',
    navTabs: role ? ROLE_TABS[role] : [],
    userName: state.profileForm.nome,
  };
}

sessionRouter.get('/', (_req, res) => res.json(sessionPayload()));

sessionRouter.post('/role', (req, res) => {
  actions.selectRole(req.body.role);
  res.json(sessionPayload());
});

sessionRouter.post('/enter', (_req, res) => {
  actions.enterPlatform();
  res.json(sessionPayload());
});

sessionRouter.post('/kyb', (req, res) => {
  actions.updateKybForm(req.body.field, req.body.value);
  res.json(sessionPayload());
});

sessionRouter.post('/kyb/next', (_req, res) => {
  actions.kybNext();
  res.json(sessionPayload());
});

sessionRouter.post('/kyb/back', (_req, res) => {
  actions.kybBack();
  res.json(sessionPayload());
});

sessionRouter.post('/onboarding/next', (_req, res) => {
  const role = state.userRole || 'investidor';
  actions.onboardingNext(ONBOARDING_STEPS[role].length);
  res.json(sessionPayload());
});

sessionRouter.post('/onboarding/skip', (_req, res) => {
  actions.skipOnboarding();
  res.json(sessionPayload());
});

sessionRouter.post('/logout', (_req, res) => {
  actions.logout();
  res.json(sessionPayload());
});
