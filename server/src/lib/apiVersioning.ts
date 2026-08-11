import type { NextFunction, Request, Response } from 'express';
import { getPlatformSetting, setPlatformSetting } from '../db/platformSettings.js';

// Real API versioning/deprecation mechanism for the public partner API (/api/v1) — see
// docs/api-versioning-policy.md for the full written policy (what counts as a breaking
// change, the minimum notice period before a sunset, how a future v2 would coexist with
// v1 rather than replace it overnight). /v1 has never been deprecated — no partner has
// ever been told to migrate off it — so this stays a real, tested, currently-inert
// mechanism today, same "real-when-configured" discipline as every other admin-tunable
// knob in this codebase (the Compliance Engine's suspend threshold, suspicious-activity
// limits): the moment a real v1→v2 migration is actually announced, an admin sets a real
// sunset date here (`PUT /admin/api-versioning`) and every /v1 response starts advertising
// it for real, with no code deploy needed.
const SUNSET_KEY = 'api_v1_sunset_at';

export function getV1SunsetDate(): string | null {
  const raw = getPlatformSetting(SUNSET_KEY);
  return raw && raw.trim() ? raw : null;
}

export function setV1SunsetDate(date: string | null, updatedBy?: number) {
  setPlatformSetting(SUNSET_KEY, date ?? '', updatedBy);
}

// RFC 8594's `Sunset` header plus the `Deprecation` header the same real APIs partners
// already integrate against (GitHub, Stripe, Twilio) use in practice — real, inspectable
// HTTP headers a partner's own client/monitoring can key off automatically, not a bespoke
// field they'd have to know to look for in a changelog. A no-op (headers simply never set)
// on every response until an admin actually configures a sunset date.
export function apiVersioningHeaders(_req: Request, res: Response, next: NextFunction) {
  const sunset = getV1SunsetDate();
  if (sunset) {
    const sunsetDate = new Date(sunset);
    if (!Number.isNaN(sunsetDate.getTime())) {
      res.setHeader('Deprecation', 'true');
      res.setHeader('Sunset', sunsetDate.toUTCString());
      res.setHeader('Link', '</docs>; rel="deprecation"; type="text/html"');
    }
  }
  next();
}
