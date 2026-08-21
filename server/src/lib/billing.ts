import Stripe from 'stripe';
import { logger } from './logger.js';
import type { Plan } from '../db/types.js';

export interface PlanDef {
  key: Plan;
  label: string;
  priceFmt: string;
  priceIdEnv?: string;
  features: string[];
}

export const PLANS: Record<Plan, PlanDef> = {
  basico: {
    key: 'basico',
    label: 'Básico',
    priceFmt: 'Grátis',
    features: [
      'Marketplace e emissão de duplicatas',
      'Até 5 duplicatas emitidas por mês (cedente)',
      'Dashboard e Carteira & Histórico',
      'Comparador de Taxas',
    ],
  },
  pro: {
    key: 'pro',
    label: 'Pro',
    priceFmt: 'R$ 299/mês',
    priceIdEnv: 'STRIPE_PRICE_PRO',
    features: ['Tudo do Básico', 'Emissões ilimitadas', 'Automação de Lances'],
  },
  empresarial: {
    key: 'empresarial',
    label: 'Empresarial',
    priceFmt: 'R$ 999/mês',
    priceIdEnv: 'STRIPE_PRICE_EMPRESARIAL',
    features: ['Tudo do Pro', 'Ambiente de Desenvolvedores (API, webhooks)', 'Suporte prioritário'],
  },
};

export const BASICO_MONTHLY_EMIT_LIMIT = 5;

const PLAN_RANK: Record<Plan, number> = { basico: 0, pro: 1, empresarial: 2 };

export function planAtLeast(plan: Plan, required: Plan): boolean {
  return PLAN_RANK[plan] >= PLAN_RANK[required];
}

const secretKey = process.env.STRIPE_SECRET_KEY;
export const stripe = secretKey ? new Stripe(secretKey) : null;
export const billingEnabled = !!stripe;

if (stripe) logger.info('[billing] Stripe configured — real checkout/portal/webhooks enabled');
else logger.info('[billing] STRIPE_SECRET_KEY not set — plan changes will be simulated locally');

export function priceIdFor(plan: Plan): string | null {
  const def = PLANS[plan];
  if (!def.priceIdEnv) return null;
  return process.env[def.priceIdEnv] || null;
}
