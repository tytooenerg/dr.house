import { logger } from './logger.js';

// The Banco Central authorized four registradoras for the duplicata escritural
// (Resolução BCB nº 339/2023): B3, CERC, Núclea and Grafeno (SPC). Today most
// integrations hardcode a single one; this is the abstraction layer a cedente/API
// partner shouldn't have to think about — Lastro picks the best route per operation.
export const REGISTRADORAS = [
  { key: 'cerc', name: 'CERC', custoPct: 0.015, tempoMedioSeg: 40, confiabilidadePct: 99.5 },
  { key: 'b3', name: 'B3', custoPct: 0.02, tempoMedioSeg: 25, confiabilidadePct: 99.8 },
  { key: 'nucleo', name: 'Núclea', custoPct: 0.012, tempoMedioSeg: 55, confiabilidadePct: 99.2 },
  { key: 'grafeno', name: 'Grafeno (SPC)', custoPct: 0.01, tempoMedioSeg: 60, confiabilidadePct: 98.7 },
] as const;

export type RegistradoraKey = (typeof REGISTRADORAS)[number]['key'];

export function getRegistradora(key: string | null) {
  return REGISTRADORAS.find((r) => r.key === key) ?? null;
}

// Smart routing: minimize registration cost, but for larger operations (where a
// failed/slow registration is costlier to redo) only route to registradoras with a
// track record of 99%+ reliability — this is why small tickets land on the cheapest
// option (Grafeno) while larger ones land on a pricier but more reliable one (Núclea).
export function chooseRegistradora(valor: number) {
  const eligible = valor > 200_000 ? REGISTRADORAS.filter((r) => r.confiabilidadePct >= 99) : REGISTRADORAS;
  return eligible.reduce((best, r) => (r.custoPct < best.custoPct ? r : best));
}

// Per-registradora API config. IMPORTANT distinction from lib/paymentRail.ts: Pix's
// "API Pix" is a BACEN-mandated public standard every PSP implements identically, so that
// adapter is built against a verified real spec. CERC/B3/Núclea/Grafeno's registration
// APIs are private commercial contracts — not publicly documented the same way — so this
// is a reasonable, generic REST shape (POST a registration, get a registro number back),
// meant to be a real, working starting point that you adjust to the exact contract your
// registradora hands you once you have a licensed integration agreement with them. It is
// NOT a verified copy of any one registradora's actual API.
const REGISTRY_ENV: Record<RegistradoraKey, { url?: string; key?: string }> = {
  cerc: { url: process.env.REGISTRADORA_CERC_API_URL, key: process.env.REGISTRADORA_CERC_API_KEY },
  b3: { url: process.env.REGISTRADORA_B3_API_URL, key: process.env.REGISTRADORA_B3_API_KEY },
  nucleo: { url: process.env.REGISTRADORA_NUCLEA_API_URL, key: process.env.REGISTRADORA_NUCLEA_API_KEY },
  grafeno: { url: process.env.REGISTRADORA_GRAFENO_API_URL, key: process.env.REGISTRADORA_GRAFENO_API_KEY },
};

export function registradoraConfigured(key: RegistradoraKey): boolean {
  const cfg = REGISTRY_ENV[key];
  return !!(cfg.url && cfg.key);
}

const anyConfigured = (Object.keys(REGISTRY_ENV) as RegistradoraKey[]).some(registradoraConfigured);
if (anyConfigured) logger.info('[registradoras] ao menos uma registradora tem API real configurada');
else logger.info('[registradoras] nenhuma REGISTRADORA_*_API_URL configurada — registro seguirá simulado');

export interface RegistroResult {
  registro: string;
  simulado: boolean;
}

export class RegistroIndisponivelError extends Error {}

// Real HTTP round-trip when the chosen registradora has REGISTRADORA_<X>_API_URL/KEY set;
// otherwise falls back to the same simulated delay + registro-number generation the app
// always used (including its ~12% simulated instability, so retry/error-handling paths
// stay exercised), so the demo and CI keep working with zero configuration.
export async function registrarNaRegistradora(opts: {
  registradoraKey: RegistradoraKey;
  duplicataId: string;
  valor: number;
  sacadoCnpj: string;
  vencimento: string;
}): Promise<RegistroResult> {
  const cfg = REGISTRY_ENV[opts.registradoraKey];
  if (!cfg.url || !cfg.key) {
    await new Promise((r) => setTimeout(r, 1100));
    if (Math.random() < 0.12) throw new RegistroIndisponivelError('simulated instability');
    return { registro: 'ESC-2026-' + Math.floor(Math.random() * 900000 + 100000), simulado: true };
  }
  const res = await fetch(`${cfg.url}/registros`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identificadorExterno: opts.duplicataId,
      valor: opts.valor.toFixed(2),
      sacadoCnpj: opts.sacadoCnpj.replace(/\D/g, ''),
      vencimento: opts.vencimento,
    }),
  });
  if (!res.ok) throw new Error(`registradora_registro_failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { registro: string };
  return { registro: data.registro, simulado: false };
}

export type NegociacaoEvento = 'compra' | 'revenda' | 'financiamento';

// Achado corrigido (auditoria de conformidade): a Resolução BCB nº 540/2025 reforça que
// o sacador deve informar a registradora sobre atos/contratos de negociação da duplicata
// — independente do ambiente em que aconteçam — não só registrar a emissão original.
// Antes desta função, registrarNaRegistradora só era chamada em lib/emitirCore.ts (na
// emissão); nada informava a registradora quando a duplicata de fato mudava de mãos
// (compra, revenda, financiamento). Mesmo padrão dual real-when-configured de
// registrarNaRegistradora acima, mas nunca bloqueia a operação real: informar a
// registradora é uma obrigação de compliance sobre uma negociação que já aconteceu, não
// uma condição pra ela acontecer — uma falha aqui é logada, nunca propagada pra reverter
// dinheiro já movido (mesmo espírito de lib/webhookDelivery.ts's deliverWebhookEvent).
export async function informarNegociacao(opts: {
  registradoraKey: RegistradoraKey | null;
  duplicataId: string;
  evento: NegociacaoEvento;
  valor: number;
}): Promise<{ confirmado: boolean; simulado: boolean }> {
  if (!opts.registradoraKey) {
    logger.warn({ duplicataId: opts.duplicataId, evento: opts.evento }, '[registradoras] duplicata sem registradora conhecida — negociação não pôde ser informada');
    return { confirmado: false, simulado: true };
  }
  const cfg = REGISTRY_ENV[opts.registradoraKey];
  try {
    if (!cfg.url || !cfg.key) {
      logger.info(
        { registradoraKey: opts.registradoraKey, duplicataId: opts.duplicataId, evento: opts.evento },
        '[registradoras] negociação informada (simulada) — Resolução BCB nº 540/2025'
      );
      return { confirmado: true, simulado: true };
    }
    const res = await fetch(`${cfg.url}/registros/${encodeURIComponent(opts.duplicataId)}/negociacoes`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ evento: opts.evento, valor: opts.valor.toFixed(2) }),
    });
    if (!res.ok) throw new Error(`registradora_negociacao_failed: ${res.status} ${await res.text()}`);
    return { confirmado: true, simulado: false };
  } catch (err) {
    logger.warn({ err, registradoraKey: opts.registradoraKey, duplicataId: opts.duplicataId, evento: opts.evento }, '[registradoras] falha ao informar negociação');
    return { confirmado: false, simulado: !cfg.url || !cfg.key };
  }
}

// Duplicidade check against the chosen registradora's own book (in addition to Lastro's
// own — see lib/dupCheck.ts). Returns null (meaning "couldn't check externally, don't
// claim otherwise") when unconfigured, rather than silently reporting "no duplicidade".
export async function checkDuplicidadeNaRegistradora(
  registradoraKey: RegistradoraKey,
  sacadoCnpj: string,
  valor: number,
  vencimento: string
): Promise<{ duplicidadeEncontrada: boolean } | null> {
  const cfg = REGISTRY_ENV[registradoraKey];
  if (!cfg.url || !cfg.key) return null;
  const res = await fetch(
    `${cfg.url}/registros/duplicidade?sacadoCnpj=${encodeURIComponent(sacadoCnpj.replace(/\D/g, ''))}&valor=${valor.toFixed(2)}&vencimento=${encodeURIComponent(vencimento)}`,
    { headers: { Authorization: `Bearer ${cfg.key}` } }
  );
  if (!res.ok) throw new Error(`registradora_dupcheck_failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { duplicidadeEncontrada: boolean };
  return { duplicidadeEncontrada: !!data.duplicidadeEncontrada };
}
