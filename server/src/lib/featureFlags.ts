import crypto from 'node:crypto';
import { getFeatureFlagOverride, listFeatureFlagOverrides, upsertFeatureFlag, type FeatureFlagRow } from '../db/featureFlags.js';

export interface FeatureFlagDef {
  key: string;
  label: string;
  description: string;
  // What the flag does when no admin has ever touched it — the app must behave exactly
  // like this feature-flags system didn't exist until someone deliberately overrides it.
  defaultEnabled: boolean;
}

// Real gates, each checked at a genuine call site (see grep for isFeatureEnabled) — not a
// catalog of aspirational toggles nobody reads. Add a new flag here first, then wire the
// isFeatureEnabled() check at the point that actually needs to respect it.
export const FEATURE_FLAG_DEFS: FeatureFlagDef[] = [
  {
    key: 'new_registrations',
    label: 'Novos cadastros',
    description: 'Kill switch operacional: desative para bloquear novas contas (e-mail/senha, Google, SAML) durante um incidente, sem tirar o site do ar para quem já tem conta.',
    defaultEnabled: true,
  },
  {
    key: 'embeddable_widget',
    label: 'Widget incorporável',
    description: 'Liga/desliga o endpoint público do simulador de antecipação (usado pelo widget embutível em sites de parceiros). Útil para conter abuso de um domínio específico sem mexer no rate limit global.',
    defaultEnabled: true,
  },
  {
    key: 'secondary_market_block_trade',
    label: 'Block trade institucional',
    description: 'Liga/desliga a execução de block trades no mercado secundário (lib/blockTrade.ts) sem afetar lances e vendas normais de posições.',
    defaultEnabled: true,
  },
  {
    key: 'market_maker_agent',
    label: 'Agente Market Maker',
    description: 'Kill switch global do 11º agente (liquidez automatizada). Complementa o kill switch por conta em Automação — este desliga para todo mundo de uma vez, por exemplo durante uma instabilidade de mercado.',
    defaultEnabled: true,
  },
  {
    key: 'reconciliation_agent',
    label: 'Reconciliação automática',
    description: 'Liga/desliga a varredura periódica do Agente de Reconciliação (lib/reconciliationAgentJob.ts). O botão manual "Rodar reconciliação agora" no back-office continua funcionando mesmo desligada — este flag só pausa o cron de 6h.',
    defaultEnabled: true,
  },
  {
    key: 'ad_carousel',
    label: 'Carrossel de publicidade',
    description: 'Liga/desliga o carrossel de publicidade da landing page (GET /public/advertisements) sem afetar a fila de moderação nem a cobrança dos anunciantes — útil pra tirar um anúncio problemático do ar imediatamente, sem depender de reprovar/desativar cada um.',
    defaultEnabled: true,
  },
];

const DEF_BY_KEY = new Map(FEATURE_FLAG_DEFS.map((d) => [d.key, d]));

export function getFeatureFlagDef(key: string): FeatureFlagDef | undefined {
  return DEF_BY_KEY.get(key);
}

// Deterministic bucketing: the same (key, userId) pair always lands on the same side of
// a partial rollout, so a user doesn't flicker between the old and new behavior from one
// request to the next. Anonymous callers (no userId) always get the fully-enabled path
// at rollout < 100 — a partial rollout only makes sense against a stable identity.
function bucket(key: string, userId: number): number {
  const hash = crypto.createHash('sha256').update(`${key}:${userId}`).digest();
  return hash.readUInt32BE(0) % 100;
}

export function isFeatureEnabled(key: string, opts: { userId?: number } = {}): boolean {
  const def = getFeatureFlagDef(key);
  const override = getFeatureFlagOverride(key);
  const enabled = override ? !!override.enabled : (def?.defaultEnabled ?? true);
  if (!enabled) return false;
  const rolloutPct = override ? override.rollout_pct : 100;
  if (rolloutPct >= 100) return true;
  if (rolloutPct <= 0) return false;
  if (opts.userId === undefined) return true;
  return bucket(key, opts.userId) < rolloutPct;
}

export interface FeatureFlagView {
  key: string;
  label: string;
  description: string;
  defaultEnabled: boolean;
  enabled: boolean;
  rolloutPct: number;
  isOverridden: boolean;
  updatedAt: string | null;
}

// Merges the code-defined catalog with whatever an admin has actually overridden, so the
// panel always shows every known flag (even ones nobody has touched yet) with its
// effective state.
export function listFeatureFlagViews(): FeatureFlagView[] {
  const overrides = new Map<string, FeatureFlagRow>(listFeatureFlagOverrides().map((r) => [r.key, r]));
  return FEATURE_FLAG_DEFS.map((def) => {
    const o = overrides.get(def.key);
    return {
      key: def.key,
      label: def.label,
      description: def.description,
      defaultEnabled: def.defaultEnabled,
      enabled: o ? !!o.enabled : def.defaultEnabled,
      rolloutPct: o ? o.rollout_pct : 100,
      isOverridden: !!o,
      updatedAt: o?.updated_at ?? null,
    };
  });
}

export function setFeatureFlag(key: string, enabled: boolean, rolloutPct: number, updatedBy: number): FeatureFlagView | undefined {
  if (!getFeatureFlagDef(key)) return undefined;
  const clampedPct = Math.max(0, Math.min(100, Math.round(rolloutPct)));
  upsertFeatureFlag(key, enabled, clampedPct, updatedBy);
  return listFeatureFlagViews().find((f) => f.key === key);
}
