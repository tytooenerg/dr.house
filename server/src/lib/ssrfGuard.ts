import dns from 'node:dns/promises';
import net from 'node:net';

// Found in the security self-review that shipped alongside this file (see
// docs/security-review-2026-08.md, finding SR-1): partner webhook URLs
// (routes/dev.ts POST /webhooks) were accepted with only `z.string().url()` — syntactic
// validation, not a check on *where* the URL actually points. Since lib/webhookDelivery.ts
// makes a real server-side POST to that URL whenever an event fires, an authenticated
// Empresarial-plan user could register a webhook pointed at an internal address (a
// database on the private network, a cloud metadata endpoint like 169.254.169.254, a
// service on localhost) and use Lastro's own server as an SSRF proxy to reach it. This
// module closes that gap.
//
// Checked in two places, deliberately: once at registration time (immediate feedback to
// the user, POST /webhooks) and again right before each delivery attempt
// (lib/webhookDelivery.ts) — a DNS-rebinding attacker could otherwise register a domain
// that resolves to a public IP at validation time and swap its DNS record to an internal
// IP before the webhook actually fires.

const BLOCKED_HOSTNAMES = new Set(['localhost', 'metadata.google.internal']);

function isLoopbackIp(ip: string): boolean {
  const type = net.isIP(ip);
  if (type === 4) return ip.startsWith('127.');
  if (type === 6) return ip.toLowerCase() === '::1' || ip.toLowerCase() === '::ffff:127.0.0.1';
  return false;
}

function isBlockedIp(ip: string): boolean {
  const type = net.isIP(ip);
  if (type === 0) return true; // not a valid IP at all — reject rather than let it through
  // The webhook-delivery integration tests (server/test/partner-api*.test.ts) deliberately
  // point real webhooks at a same-process local HTTP server (http://127.0.0.1:<port>) to
  // prove delivery actually happens over the network, not just that a URL string was
  // accepted — so loopback specifically is allowed under Vitest. Every other private range
  // below stays blocked even in tests, since nothing in the test suite needs them and
  // relaxing more than this one, deliberately-exercised case would mask a real bug.
  if (process.env.VITEST && isLoopbackIp(ip)) return false;
  if (type === 4) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 127) return true; // loopback
    if (a === 10) return true; // RFC1918
    if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
    if (a === 192 && b === 168) return true; // RFC1918
    if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata (169.254.169.254)
    if (a === 0) return true; // "this network"
    if (a >= 224) return true; // multicast/reserved
    return false;
  }
  // IPv6
  const lower = ip.toLowerCase();
  if (lower === '::1') return true; // loopback
  if (lower.startsWith('fe80:') || lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true; // link-local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local (RFC4193)
  if (lower.startsWith('::ffff:')) return isBlockedIp(lower.slice(7)); // IPv4-mapped IPv6
  return false;
}

export interface SsrfCheckResult {
  safe: boolean;
  reason?: string;
}

// Resolves the URL's hostname for real and rejects anything pointing at a private,
// loopback, link-local or otherwise non-public address. Fails closed: a DNS lookup error
// or an unparseable URL is treated as unsafe, never let through by default.
export async function checkUrlIsPublic(rawUrl: string): Promise<SsrfCheckResult> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { safe: false, reason: 'URL inválida.' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { safe: false, reason: 'Apenas URLs http:// ou https:// são permitidas.' };
  }
  const hostname = url.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { safe: false, reason: 'Esse endereço não pode ser usado para webhooks.' };
  }
  // A literal IP in the URL (no DNS involved) — check it directly.
  if (net.isIP(hostname)) {
    return isBlockedIp(hostname) ? { safe: false, reason: 'Esse endereço não pode ser usado para webhooks.' } : { safe: true };
  }
  try {
    const records = await dns.lookup(hostname, { all: true });
    if (records.length === 0) return { safe: false, reason: 'Não foi possível resolver esse endereço.' };
    if (records.some((r) => isBlockedIp(r.address))) {
      return { safe: false, reason: 'Esse endereço resolve para uma rede privada e não pode ser usado para webhooks.' };
    }
    return { safe: true };
  } catch {
    return { safe: false, reason: 'Não foi possível resolver esse endereço.' };
  }
}
