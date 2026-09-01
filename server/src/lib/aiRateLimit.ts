import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

// Every internal route that calls the real Anthropic API (chat, dispute/sinistro
// copilots, NF-e/contract analysis, risk narrative, PLD second opinion via KYB) shares
// this limiter — each call is a real, metered cost (see lib/claude.ts's usage logging),
// unlike most of the app's other endpoints. Keyed per authenticated user, not per IP, so
// it can't be trivially bypassed and doesn't penalize other users sharing a NAT/office IP.
// Must be mounted after requireAuth so req.user is populated when keyGenerator runs.
export const aiFeatureLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => !!process.env.VITEST,
  // ipKeyGenerator normalizes IPv6 addresses (which have many equivalent textual forms)
  // before using them as a fallback key — a raw `req.ip` here would let the same client
  // dodge the limit just by varying how its address is written.
  keyGenerator: (req) => (req.user ? `user:${req.user.id}` : req.ip ? ipKeyGenerator(req.ip) : 'anon'),
  message: { error: 'rate_limited', message: 'Muitas solicitações de IA em pouco tempo — aguarde alguns minutos e tente novamente.' },
});
