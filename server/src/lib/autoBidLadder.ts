import type { Rating } from '../data/seed.js';
import type { LadderConfig } from '../db/types.js';
import { estimateRateBand } from './dynamicPricing.js';

// Escada de lances por classe de rating (Automação de Lances) — ver o comentário de
// LadderConfig em db/types.ts pro raciocínio completo. Este arquivo só tem as funções
// puras que calculam o degrau atual; a leitura/escrita de UserSettings.autoBidLadder e a
// aplicação do gate de compra ficam em routes/automation.ts.

// A banda de referência desta classe agora mesmo — mesma fonte usada em qualquer outro
// lugar que precifica (marketCompute.ts, emitirCore.ts, confirmingCore.ts): ajustada por
// liquidez real dos últimos 30 dias, não um número fixo. taxaInicial/taxaAlvo nulos usam
// isso como default, então o "topo"/"piso" da escada acompanha o mercado real sem o
// investidor precisar reconfigurar nada.
export function getLadderBand(rating: Rating): { min: number; max: number } {
  const { min, max } = estimateRateBand(rating);
  return { min, max };
}

// O deságio mínimo que a automação aceita AGORA para esta classe. Começa em taxaInicial (o
// degrau mais exigente — só os melhores deságios) e cai `decrementoPorEtapa` a cada
// `intervaloHoras` sem compra, nunca abaixo de taxaAlvo (o piso que o investidor configurou
// como mínimo aceitável). Se a escada nunca foi armada (`iniciadoEm === null`), ainda está
// no primeiro degrau.
export function currentFloor(cfg: LadderConfig, rating: Rating, now: Date = new Date()): number {
  const { min: bandMin, max: bandMax } = getLadderBand(rating);
  const inicial = cfg.taxaInicial ?? bandMax;
  const alvo = cfg.taxaAlvo ?? bandMin;
  if (!cfg.iniciadoEm) return inicial;
  const elapsedMs = now.getTime() - new Date(cfg.iniciadoEm).getTime();
  const steps = Math.max(0, Math.floor(elapsedMs / (cfg.intervaloHoras * 3600_000)));
  return Math.max(alvo, inicial - cfg.decrementoPorEtapa * steps);
}

// Quando a próxima queda de degrau acontece (null se já está no piso ou nunca foi armada —
// nesses casos não há "próxima queda" relevante pro investidor acompanhar).
export function nextStepAt(cfg: LadderConfig, rating: Rating, now: Date = new Date()): Date | null {
  if (!cfg.iniciadoEm) return null;
  const { min: bandMin } = getLadderBand(rating);
  const alvo = cfg.taxaAlvo ?? bandMin;
  if (currentFloor(cfg, rating, now) <= alvo) return null; // já no piso, escada parou
  const elapsedMs = now.getTime() - new Date(cfg.iniciadoEm).getTime();
  const stepMs = cfg.intervaloHoras * 3600_000;
  const nextStepMs = (Math.floor(elapsedMs / stepMs) + 1) * stepMs;
  return new Date(new Date(cfg.iniciadoEm).getTime() + nextStepMs);
}

// Rearma o relógio desta classe — chamado ao ligar a automação, editar a escada desta
// classe, ou depois de uma compra nesta classe (o próximo ciclo de negociação volta a ser
// exigente, mesma lógica de qualquer negociação real recomeçar do zero).
export function armLadder(): Pick<LadderConfig, 'iniciadoEm'> {
  return { iniciadoEm: new Date().toISOString() };
}
