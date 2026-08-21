import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import { getUserByStripeCustomerId, setStripeCustomerId, updateSubscription } from '../db/users.js';
import { recordAuditEvent } from '../db/audit.js';
import { billingEnabled, PLANS, priceIdFor, stripe } from '../lib/billing.js';
import { logger } from '../lib/logger.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import type { Plan } from '../db/types.js';

export const billingRouter = Router();
billingRouter.use(requireAuth);

billingRouter.get('/', (req, res) => {
  res.json({
    billingEnabled,
    currentPlan: req.user!.plan,
    subscriptionStatus: req.user!.subscription_status,
    currentPeriodEnd: req.user!.plan_current_period_end,
    plans: Object.values(PLANS),
  });
});

const checkoutSchema = z.object({ plan: z.enum(['basico', 'pro', 'empresarial']) });

billingRouter.post(
  '/checkout',
  asyncHandler(async (req, res) => {
    const parsed = checkoutSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    const plan = parsed.data.plan as Plan;

    if (plan === 'basico') {
      updateSubscription(req.user!.id, { plan: 'basico', subscriptionStatus: 'none', stripeSubscriptionId: null, currentPeriodEnd: null });
      recordAuditEvent(req.user!.id, req.user!.company_name, 'billing.downgraded_to_basico', {});
      res.json({ simulated: true, url: null });
      return;
    }

    if (!stripe) {
      // No Stripe key configured — simulate the subscription becoming active immediately so the
      // rest of the product (feature gating, plan display) is fully demoable without real billing.
      updateSubscription(req.user!.id, { plan, subscriptionStatus: 'active_demo', stripeSubscriptionId: null, currentPeriodEnd: null });
      recordAuditEvent(req.user!.id, req.user!.company_name, 'billing.plan_changed_demo', { plan });
      res.json({ simulated: true, url: null });
      return;
    }

    const priceId = priceIdFor(plan);
    if (!priceId) {
      res.status(500).json({ error: 'plan_not_configured', message: `Preço do plano ${plan} não configurado (defina STRIPE_PRICE_${plan.toUpperCase()}).` });
      return;
    }

    let customerId = req.user!.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({ email: req.user!.email, name: req.user!.company_name });
      customerId = customer.id;
      setStripeCustomerId(req.user!.id, customerId);
    }

    const origin = req.headers.origin || `http://localhost:${process.env.PORT || 4000}`;
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/app/assinatura?checkout=success`,
      cancel_url: `${origin}/app/assinatura?checkout=canceled`,
      client_reference_id: String(req.user!.id),
    });
    res.json({ simulated: false, url: session.url });
  })
);

billingRouter.post(
  '/portal',
  asyncHandler(async (req, res) => {
    if (!stripe || !req.user!.stripe_customer_id) {
      res.json({ simulated: true, url: null, message: 'Assinatura simulada — sem faturamento real para gerenciar. Use "Voltar ao Básico" para simular o cancelamento.' });
      return;
    }
    const origin = req.headers.origin || `http://localhost:${process.env.PORT || 4000}`;
    const session = await stripe.billingPortal.sessions.create({
      customer: req.user!.stripe_customer_id,
      return_url: `${origin}/app/assinatura`,
    });
    res.json({ simulated: false, url: session.url });
  })
);

function planFromPriceId(priceId: string | undefined): Plan | null {
  if (!priceId) return null;
  if (priceId === process.env.STRIPE_PRICE_PRO) return 'pro';
  if (priceId === process.env.STRIPE_PRICE_EMPRESARIAL) return 'empresarial';
  return null;
}

// Mounted separately in app.ts with express.raw() BEFORE the global express.json()
// middleware — Stripe's signature verification needs the exact raw request body.
export async function handleStripeWebhook(req: Request, res: Response) {
  if (!stripe) {
    res.status(503).json({ error: 'billing_disabled' });
    return;
  }
  const signature = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !webhookSecret) {
    res.status(400).json({ error: 'missing_signature' });
    return;
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
  } catch (err) {
    logger.warn({ err }, '[billing] webhook signature verification failed');
    res.status(400).json({ error: 'invalid_signature' });
    return;
  }

  switch (event.type) {
    case 'checkout.session.completed':
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const subscription =
        event.type === 'checkout.session.completed'
          ? await stripe.subscriptions.retrieve((event.data.object as { subscription: string }).subscription)
          : (event.data.object as import('stripe').Stripe.Subscription);
      const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;
      const user = getUserByStripeCustomerId(customerId);
      const priceId = subscription.items.data[0]?.price.id;
      const plan = planFromPriceId(priceId);
      if (user && plan) {
        const periodEnd = subscription.items.data[0]?.current_period_end;
        updateSubscription(user.id, {
          plan,
          subscriptionStatus: subscription.status === 'active' ? 'active' : 'past_due',
          stripeSubscriptionId: subscription.id,
          currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
        });
        recordAuditEvent(user.id, user.company_name, 'billing.subscription_updated', { plan, status: subscription.status });
      }
      break;
    }
    case 'customer.subscription.deleted': {
      const subscription = event.data.object as import('stripe').Stripe.Subscription;
      const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;
      const user = getUserByStripeCustomerId(customerId);
      if (user) {
        updateSubscription(user.id, { plan: 'basico', subscriptionStatus: 'canceled', stripeSubscriptionId: null, currentPeriodEnd: null });
        recordAuditEvent(user.id, user.company_name, 'billing.subscription_canceled', {});
      }
      break;
    }
    default:
      break;
  }

  res.json({ received: true });
}
