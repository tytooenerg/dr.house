import { logger } from './logger.js';

// Real, free, public sanctions data — OFAC's SDN (Specially Designated Nationals) list,
// published openly by the US Treasury, no account/credentials needed. Different from the
// registradora/payment-rail/bureau adapters elsewhere in this codebase: those need a paid
// commercial contract this environment can't provide, this one doesn't. It's opt-in via
// SANCTIONS_LIVE_FEED purely to keep local dev/CI fast and network-independent — not
// because of cost or access.
//
// Also screens the UN Security Council Consolidated List (below) — unlike OFAC/EU, UN
// sanctions are directly, self-executingly binding in Brazil regardless of any foreign
// counterparty (Lei 13.810/2019 art. 4/7), so this one isn't just "nice to have" once
// SANCTIONS_LIVE_FEED is on. A production deployment would also want the EU consolidated
// list and, ideally, a licensed COAF/CVM feed — natural next steps, not implemented here
// to keep this adapter's XML/format-parsing surface small and reliable.

const liveFeedEnabled = process.env.SANCTIONS_LIVE_FEED === 'true';
const SDN_CSV_URL = process.env.OFAC_SDN_CSV_URL || 'https://www.treasury.gov/ofac/downloads/sdn.csv';
const UN_SC_XML_URL = process.env.UN_SC_XML_URL || 'https://scsanctions.un.org/resources/xml/en/consolidated.xml';

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

let unCache: { entries: SdnEntry[]; fetchedAt: number } | null = null;

function tagText(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}>([^<]*)</${tag}>`, 'i'));
  return m ? m[1].trim() : '';
}

// The UN Secretariat's Consolidated List XML groups individuals under <INDIVIDUAL> (name
// split across FIRST_NAME/SECOND_NAME/THIRD_NAME/FOURTH_NAME) and organizations under
// <ENTITY> (full name in FIRST_NAME). Parsed defensively by tag content, not a strict
// schema validator — a field the UN renames or drops just yields fewer/no matches for
// that record rather than throwing, same fail-open posture as the OFAC CSV parser above.
// Exported for direct unit testing (see test/foreign-investor.test.ts) — there's no
// SANCTIONS_LIVE_FEED=true in the test environment (by design, to keep CI network-free),
// so this is the only way to verify the parsing logic itself against a realistic sample.
export function parseUnConsolidatedXml(xml: string): SdnEntry[] {
  const entries: SdnEntry[] = [];
  const individualBlocks = xml.match(/<INDIVIDUAL>[\s\S]*?<\/INDIVIDUAL>/gi) || [];
  for (const block of individualBlocks) {
    const nome = [tagText(block, 'FIRST_NAME'), tagText(block, 'SECOND_NAME'), tagText(block, 'THIRD_NAME'), tagText(block, 'FOURTH_NAME')]
      .filter(Boolean)
      .join(' ');
    if (nome) entries.push({ nome, programa: tagText(block, 'UN_LIST_TYPE') || 'ONU' });
  }
  const entityBlocks = xml.match(/<ENTITY>[\s\S]*?<\/ENTITY>/gi) || [];
  for (const block of entityBlocks) {
    const nome = tagText(block, 'FIRST_NAME');
    if (nome) entries.push({ nome, programa: tagText(block, 'UN_LIST_TYPE') || 'ONU' });
  }
  return entries;
}

async function refreshUnCache(): Promise<SdnEntry[]> {
  const res = await fetch(UN_SC_XML_URL);
  if (!res.ok) throw new Error(`un_sc_fetch_failed: ${res.status}`);
  const xml = await res.text();
  const entries = parseUnConsolidatedXml(xml);
  unCache = { entries, fetchedAt: Date.now() };
  logger.info({ count: entries.length }, '[sanctions] Lista Consolidada do CSNU atualizada');
  return entries;
}

async function getUnEntries(): Promise<SdnEntry[]> {
  if (unCache && Date.now() - unCache.fetchedAt < CACHE_TTL_MS) return unCache.entries;
  try {
    return await refreshUnCache();
  } catch (err) {
    logger.warn({ err }, '[sanctions] falha ao baixar a Lista Consolidada do CSNU — mantendo cache anterior (se houver)');
    return unCache?.entries ?? [];
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
  fonte: 'ofac' | 'un_sc';
}

export async function screenAgainstPaidProvider(nome: string, cnpj: string): Promise<{ nome: string; programa: string } | null> {
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
function findMatch(entries: SdnEntry[], needle: string): SdnEntry | undefined {
  return entries.find((e) => {
    const candidate = normalize(e.nome);
    return candidate.length >= 6 && (candidate.includes(needle) || needle.includes(candidate));
  });
}

// Checks OFAC first, then the UN Security Council Consolidated List — both free/public,
// both gated by the same SANCTIONS_LIVE_FEED flag (see module comment for why the UN list
// isn't optional the way OFAC arguably is).
export async function screenAgainstLiveFeed(nome: string): Promise<LiveScreeningMatch | null> {
  if (!liveFeedEnabled) return null;
  const needle = normalize(nome);
  if (needle.length < 6) return null;

  const ofacHit = findMatch(await getEntries(), needle);
  if (ofacHit) return { nome: ofacHit.nome, programa: ofacHit.programa, fonte: 'ofac' };

  const unHit = findMatch(await getUnEntries(), needle);
  if (unHit) return { nome: unHit.nome, programa: unHit.programa, fonte: 'un_sc' };

  return null;
}
