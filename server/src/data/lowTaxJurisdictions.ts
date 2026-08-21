// Jurisdições de tributação favorecida e regimes fiscais privilegiados, per Lei
// 9.779/1999 art. 24 and IN RFB 1.037/2010 (as amended) — the list that determines
// whether a non-resident investor's country of domicile disqualifies them from the 0%
// IRRF treatment under Lei 11.312/2006 (see lib/foreignInvestorCompliance.ts). This is a
// point-in-time snapshot of a real, named administrative list — not a live feed, since
// there's no free official API for it (same honest limitation as the registradora
// adapters). Confirm against the current consolidated IN RFB 1.037/2010 text before
// relying on this for an actual investor decision — it is amended from time to time.
export const LOW_TAX_JURISDICTIONS: string[] = [
  'andorra',
  'anguilla',
  'antigua e barbuda',
  'aruba',
  'ilhas ascensao',
  'bahamas',
  'bahrein',
  'barbados',
  'belize',
  'ilhas bermudas',
  'brunei',
  'campione ditalia',
  'ilhas do canal',
  'alderney',
  'guernsey',
  'jersey',
  'sark',
  'ilhas cayman',
  'chipre',
  'cingapura',
  'ilhas cook',
  'costa rica',
  'djibouti',
  'dominica',
  'emirados arabes unidos',
  'gibraltar',
  'granada',
  'hong kong',
  'kiribati',
  'lebuan',
  'labuan',
  'libano',
  'liberia',
  'liechtenstein',
  'macau',
  'ilha da madeira',
  'maldivas',
  'ilha de man',
  'ilhas marshall',
  'ilhas maurício',
  'ilhas mauricio',
  'monaco',
  'ilhas montserrat',
  'nauru',
  'ilha niue',
  'ilha norfolk',
  'panama',
  'ilha pitcairn',
  'polinesia francesa',
  'ilha queshm',
  'samoa americana',
  'samoa ocidental',
  'san marino',
  'ilhas salomao',
  'st kitts e nevis',
  'saint kitts e nevis',
  'santa lucia',
  'sao vicente e granadinas',
  'seychelles',
  'tonga',
  'ilhas turks e caicos',
  'vanuatu',
  'ilhas virgens americanas',
  'ilhas virgens britanicas',
];

function normalizeCountry(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z ]/g, '')
    .trim();
}

export function isLowTaxJurisdiction(country: string): boolean {
  const normalized = normalizeCountry(country);
  if (!normalized) return false;
  return LOW_TAX_JURISDICTIONS.some((j) => normalized === j || normalized.includes(j) || j.includes(normalized));
}
