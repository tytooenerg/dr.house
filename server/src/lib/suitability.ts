import { z } from 'zod';
import { getSuitability, upsertSuitability, type SuitabilityRow } from '../db/suitability.js';

// A CVM-style suitability questionnaire (API/PLD-adjacent regulatory concept, distinct
// from KYB/PLD) — classifies an investor as conservador/moderado/arrojado from a small,
// deterministic point-scored questionnaire, same "no black box" discipline as
// lib/mlScoring.ts's logistic regression: every point is explainable by a single question.
export interface SuitabilityOption {
  value: string;
  label: string;
  points: number;
}
export interface SuitabilityQuestion {
  id: string;
  text: string;
  options: SuitabilityOption[];
}

export const SUITABILITY_QUESTIONS: SuitabilityQuestion[] = [
  {
    id: 'objetivo',
    text: 'Qual o principal objetivo deste investimento?',
    options: [
      { value: 'preservar', label: 'Preservar o capital investido', points: 0 },
      { value: 'equilibrio', label: 'Equilíbrio entre segurança e retorno', points: 2 },
      { value: 'maximizar', label: 'Maximizar o retorno, mesmo assumindo mais risco', points: 4 },
    ],
  },
  {
    id: 'horizonte',
    text: 'Por quanto tempo pretende manter recursos aplicados neste tipo de ativo?',
    options: [
      { value: 'curto', label: 'Até 1 ano', points: 0 },
      { value: 'medio', label: 'De 1 a 3 anos', points: 2 },
      { value: 'longo', label: 'Mais de 3 anos', points: 4 },
    ],
  },
  {
    id: 'tolerancia_perda',
    text: 'Se o valor de uma posição caísse 10% de uma vez, o que você faria?',
    options: [
      { value: 'resgataria', label: 'Sairia da posição imediatamente', points: 0 },
      { value: 'desconfortavel', label: 'Manteria, mas ficaria desconfortável', points: 2 },
      { value: 'aportaria', label: 'Manteria e consideraria aportar mais', points: 4 },
    ],
  },
  {
    id: 'experiencia',
    text: 'Qual sua experiência com recebíveis/crédito privado?',
    options: [
      { value: 'nenhuma', label: 'Nunca investi neste tipo de ativo', points: 0 },
      { value: 'ocasional', label: 'Já investi ocasionalmente', points: 2 },
      { value: 'regular', label: 'Invisto regularmente ou atuo profissionalmente no mercado', points: 4 },
    ],
  },
  {
    id: 'concentracao',
    text: 'Que fração do seu patrimônio total pretende alocar neste tipo de investimento?',
    options: [
      { value: 'alta', label: 'Mais de 50%', points: 0 },
      { value: 'media', label: 'Entre 20% e 50%', points: 2 },
      { value: 'baixa', label: 'Menos de 20%', points: 4 },
    ],
  },
  {
    id: 'renda',
    text: 'Como você descreveria sua fonte de renda/patrimônio?',
    options: [
      { value: 'instavel', label: 'Renda variável ou instável', points: 0 },
      { value: 'mista', label: 'Mista', points: 2 },
      { value: 'estavel', label: 'Renda estável e patrimônio consolidado', points: 4 },
    ],
  },
];

export const MAX_SCORE = SUITABILITY_QUESTIONS.reduce((sum, q) => sum + Math.max(...q.options.map((o) => o.points)), 0);

export type SuitabilityProfile = 'conservador' | 'moderado' | 'arrojado';

export const PROFILE_LEVEL: Record<SuitabilityProfile, number> = { conservador: 0, moderado: 1, arrojado: 2 };
export const PROFILE_LABEL: Record<SuitabilityProfile, string> = { conservador: 'Conservador', moderado: 'Moderado', arrojado: 'Arrojado' };

export function profileForScore(score: number): SuitabilityProfile {
  const pct = score / MAX_SCORE;
  if (pct <= 0.35) return 'conservador';
  if (pct <= 0.7) return 'moderado';
  return 'arrojado';
}

export const SUITABILITY_VALIDITY_MONTHS = 24;

export const suitabilitySubmitSchema = z.object({
  answers: z.record(z.string(), z.string()),
});

function computeExpiresAt(from = new Date()): string {
  const d = new Date(from);
  d.setUTCMonth(d.getUTCMonth() + SUITABILITY_VALIDITY_MONTHS);
  return d.toISOString();
}

export type SubmitSuitabilityOutcome =
  | { status: 200; body: SuitabilityView }
  | { status: 400; body: { error: 'validation_error'; message: string } };

export type ScoreAnswersOutcome =
  | { status: 200; score: number; profile: SuitabilityProfile }
  | { status: 400; body: { error: 'validation_error'; message: string } };

// Pure scoring, no persistence — shared by submitSuitability below (a Lastro investor's
// own on-platform assessment, persisted to the `suitability` table) and the stateless
// Suitability API (routes/v1.ts POST /suitability/avaliar), which scores a third party's
// own end customer and has no Lastro user row to attach a result to.
export function scoreAnswers(answers: Record<string, string>): ScoreAnswersOutcome {
  let score = 0;
  for (const q of SUITABILITY_QUESTIONS) {
    const chosen = answers[q.id];
    const option = q.options.find((o) => o.value === chosen);
    if (!option) {
      return { status: 400, body: { error: 'validation_error', message: `Responda a pergunta "${q.text}" com uma das opções válidas.` } };
    }
    score += option.points;
  }
  return { status: 200, score, profile: profileForScore(score) };
}

export function submitSuitability(userId: number, answers: Record<string, string>): SubmitSuitabilityOutcome {
  const scored = scoreAnswers(answers);
  if (scored.status === 400) return scored;
  const row = upsertSuitability(userId, scored.score, scored.profile, JSON.stringify(answers), computeExpiresAt());
  return { status: 200, body: toView(row) };
}

export interface SuitabilityView {
  hasAssessment: boolean;
  profile: SuitabilityProfile | null;
  profileLabel: string | null;
  score: number | null;
  maxScore: number;
  completedAt: string | null;
  expiresAt: string | null;
  expired: boolean;
}

function toView(row: SuitabilityRow | undefined): SuitabilityView {
  if (!row) {
    return { hasAssessment: false, profile: null, profileLabel: null, score: null, maxScore: MAX_SCORE, completedAt: null, expiresAt: null, expired: false };
  }
  const expired = new Date(row.expires_at).getTime() < Date.now();
  return {
    hasAssessment: true,
    profile: row.profile,
    profileLabel: PROFILE_LABEL[row.profile],
    score: row.score,
    maxScore: MAX_SCORE,
    completedAt: row.completed_at,
    expiresAt: row.expires_at,
    expired,
  };
}

export function getSuitabilityView(userId: number): SuitabilityView {
  return toView(getSuitability(userId));
}

// The one real gate this batch wires up: cestas de investimento are the platform choosing
// where an investor's money goes (closer to a recommendation than an investor manually
// clicking "Comprar" on a specific offer), so the riskier baskets require a valid,
// non-expired assessment proving the investor's risk tolerance actually supports them.
// 'conservadora' (the safest basket) never requires an assessment — an unknown risk
// tolerance is conservatively assumed to be fine with the safest option.
export const CESTA_MIN_PROFILE_LEVEL: Record<'conservadora' | 'diversificada' | 'agressiva', number> = {
  conservadora: 0,
  diversificada: 1,
  agressiva: 2,
};

export type CestaSuitabilityCheck = { ok: true } | { ok: false; error: 'suitability_required' | 'suitability_mismatch'; message: string };

export function checkCestaSuitability(userId: number, cestaKey: keyof typeof CESTA_MIN_PROFILE_LEVEL): CestaSuitabilityCheck {
  const minLevel = CESTA_MIN_PROFILE_LEVEL[cestaKey];
  if (minLevel === 0) return { ok: true };
  const row = getSuitability(userId);
  if (!row || new Date(row.expires_at).getTime() < Date.now()) {
    return {
      ok: false,
      error: 'suitability_required',
      message: 'Esta cesta exige um perfil de suitability válido. Responda o questionário em Perfil de Investidor antes de investir.',
    };
  }
  if (PROFILE_LEVEL[row.profile] < minLevel) {
    return {
      ok: false,
      error: 'suitability_mismatch',
      message: `Seu perfil atual (${PROFILE_LABEL[row.profile]}) não comporta esta cesta. Refaça o questionário se seu perfil de risco mudou.`,
    };
  }
  return { ok: true };
}
