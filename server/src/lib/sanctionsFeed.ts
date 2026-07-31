import { logger } from './logger.js';

// Real, free, public sanctions data — OFAC's SDN (Specially Designated Nationals) list,
// published openly by the US Treasury, no account/credentials needed. Different from the
// registradora/payment-rail/bureau adapters elsewhere in this codebase: those need a paid
// commercial contract this environment can't provide, this one doesn't. It's opt-in via
// SANCTIONS_LIVE_FEED purely to keep local dev/CI fast and network-independent — not
// because of cost or access.
//
// A production deployment targeting Brazilian PLD/FT obligations specifically (Circular
// BCB 3.978/2020, COAF) would also want the UN Security Council Consolidated List and,
// ideally, a licensed COAF/CVM feed — those are natural next steps, not implemented here
// to keep this adapter's XML/format-parsing surface small and reliable.

const liveFeedEnabled = process.env.SANCTIONS_LIVE_FEED === 'true';
const SDN_CSV_URL = process.env.OFAC_SDN_CSV_URL || 'https://www.treasury.gov/ofac/downloads/sdn.csv';

export interface SdnEntry {
  nome: string;
  programa: string;
}

let cache: { entries: SdnEntry[]; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

if (liveFeedEnabled) logger.info('[sanctions] SANCTIONS_LIVE_FEED ativo — lista OFAC SDN real será baixada e cacheada');
else logger.info('[sanctions] SANCTIONS_LIVE_FEED desativado — usando apenas a watchlist de demonstração');

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

// SDN.csv has no header row: ent_num, SDN_Name, SDN_Type, Program, Title, Call_Sign,
// Vess_type, Tonnage, GRT, Vess_flag, Vess_owner, Remarks.
function parseSdnCsv(text: string): SdnEntry[] {
  const entries: SdnEntry[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const cols = parseCsvLine(line);
    const nome = cols[1]?.trim();
    if (nome) entries.push({ nome, programa: cols[3]?.trim() || '' });
  }
  return entries;
}

async function refreshCache(): Promise<SdnEntry[]> {
  const res = await fetch(SDN_CSV_URL);
  if (!res.ok) throw new Error(`ofac_sdn_fetch_failed: ${res.status}`);
  const text = await res.text();
  const entries = parseSdnCsv(text);
  cache = { entries, fetchedAt: Date.now() };
  logger.info({ count: entries.length }, '[sanctions] lista OFAC SDN atualizada');
  return entries;
}

async function getEntries(): Promise<SdnEntry[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.entries;
  try {
    return await refreshCache();
  } catch (err) {
    logger.warn({ err }, '[sanctions] falha ao baixar a lista OFAC SDN — mantendo cache anterior (se houver)');
    return cache?.entries ?? [];
  }
}

// Adapter for a licensed commercial PLD/KYC provider (e.g. Serasa Compliance, Quod, Neoway)
// — the kind of vendor Circular BCB 3.978/2020 compliance programs actually run on in
// production, covering COAF/CVM/PEP lists the free OFAC feed above doesn't. Requires a
// real commercial contract this environment can't provide, so it's unconfigured (and thus
// a no-op) by default — same honest pattern as lib/paymentRail.ts and lib/registradoras.ts.
const pldProviderUrl = process.env.PLD_PROVIDER_API_URL;
const pldProviderKey = process.env.PLD_PROVIDER_API_KEY;
export const pldProviderEnabled = !!(pldProviderUrl && pldProviderKey);

if (pldProviderEnabled) logger.info('[sanctions] provedor de PLD pago configurado — usado antes da lista OFAC/demonstração');

export interface LiveScreeningMatch {
  nome: string;
  programa: string;
}

export async function screenAgainstPaidProvider(nome: string, cnpj: string): Promise<LiveScreeningMatch | null> {
  if (!pldProviderEnabled) return null;
  const res = await fetch(`${pldProviderUrl}/screening`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${pldProviderKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nome, cnpj: cnpj.replace(/\D/g, '') }),
  });
  if (!res.ok) throw new Error(`pld_provider_failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { match: boolean; nome?: string; lista?: string };
  return data.match ? { nome: data.nome || nome, programa: data.lista || 'provedor PLD' } : null;
}

const CORP_SUFFIXES = /\b(ltda|s\.?\/?a\.?|me|epp|eireli|inc|corp|llc|co)\b\.?/gi;

function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip accents (combining diacritical marks)
    .toLowerCase()
    .replace(CORP_SUFFIXES, '')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Substring match on normalized names (accents/case/common corporate suffixes stripped),
// with a minimum length guard so short/generic tokens can't match half the list — real
// sanctions screening tools bias toward over-flagging (false positives get a human
// review), but an unguarded substring match on unnormalized names is just noise.
export async function screenAgainstLiveFeed(nome: string): Promise<LiveScreeningMatch | null> {
  if (!liveFeedEnabled) return null;
  const needle = normalize(nome);
  if (needle.length < 6) return null;
  const entries = await getEntries();
  const hit = entries.find((e) => {
    const candidate = normalize(e.nome);
    return candidate.length >= 6 && (candidate.includes(needle) || needle.includes(candidate));
  });
  return hit ? { nome: hit.nome, programa: hit.programa } : null;
}
