import { listAllDuplicatasForTraining } from '../db/duplicatas.js';
import { findSacadoByCnpj } from './riscoCore.js';
import { getPlatformSetting, setPlatformSetting } from '../db/platformSettings.js';
import { logger } from './logger.js';
import type { DuplicataRow } from '../db/types.js';

// A real trained model instead of riscoCore.ts's fixed-weight blend formula — this is what
// makes the standalone Score API product (routes/v1.ts, lib/addOnBilling.ts) an actual
// data asset instead of a static formula with a price tag on it. Deliberately dependency-
// free (plain gradient descent, no ML library) — the dataset here will start tiny, and a
// from-scratch implementation is auditable line by line rather than a black box.
//
// Honesty constraint, same as everywhere else in this codebase: with too few labeled
// outcomes to mean anything, this refuses to train (MIN_TRAINING_SAMPLES) rather than
// fitting noise and presenting it as a real model. Until a model exists, scoring falls
// back to exactly what riscoCore.ts already did — this only ever *adds* a signal once
// there's real repayment history to learn from, it never replaces the deterministic
// baseline.

export interface MLModel {
  weights: number[];
  bias: number;
  featureNames: string[];
  // Per-feature mean/std used to standardize both training and inference inputs.
  featureMeans: number[];
  featureStds: number[];
  nSamples: number;
  nPositive: number;
  trainAccuracy: number;
  trainedAt: string;
}

const MODEL_KEY = 'ml_scoring_model_v1';
export const MIN_TRAINING_SAMPLES = 12;
const FEATURE_NAMES = ['compliance_score', 'valor_log10', 'lastro_pct', 'seguro', 'sacado_score_base'];

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

// One real feature vector per duplicata — every value is derived from data already on the
// row (or the seed sacado profile), never invented. Missing compliance_score / unmatched
// sacado fall back to a neutral 50 rather than 0, so an absent signal pulls the prediction
// toward "unknown" instead of toward "worst possible".
export function extractFeatures(d: DuplicataRow): number[] {
  const complianceScore = d.compliance_score ?? 50;
  const valorLog10 = Math.log10(Math.max(d.valor, 1));
  const lastroPct = d.lastro_pct ?? 50;
  const seguro = d.seguro ? 1 : 0;
  const sacado = d.sacado_cnpj ? findSacadoByCnpj(d.sacado_cnpj) : null;
  const sacadoScoreBase = sacado?.sacado.score ?? 50;
  return [complianceScore, valorLog10, lastroPct, seguro, sacadoScoreBase];
}

// Real state transitions this codebase already performs, used as the training label — a
// real signal, not a fabricated one, even though the sample is small: sinistro aprovado is
// a confirmed insurance payout (the sacado defaulted for real); status='paga' via legal
// collection (lib/legalCollectionFee.ts) means the duplicata was distressed enough to need
// legal recovery. Everything else counts as "no risk event materialized" — which for a
// duplicata that hasn't reached vencimento yet is honestly "not yet known" as much as
// "good", a limitation worth stating rather than hiding.
function labelFor(d: DuplicataRow): number {
  return d.sinistro_status === 'aprovado' || d.status === 'paga' ? 1 : 0;
}

function mean(xs: number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

function std(xs: number[], m: number): number {
  const variance = xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length;
  return Math.sqrt(variance) || 1; // avoid divide-by-zero for a constant feature
}

function standardize(X: number[][], meansArg?: number[], stdsArg?: number[]): { Xs: number[][]; means: number[]; stds: number[] } {
  const d = X[0].length;
  const means = meansArg ?? Array.from({ length: d }, (_, j) => mean(X.map((row) => row[j])));
  const stds = stdsArg ?? Array.from({ length: d }, (_, j) => std(X.map((row) => row[j]), means[j]));
  const Xs = X.map((row) => row.map((v, j) => (v - means[j]) / stds[j]));
  return { Xs, means, stds };
}

// Plain batch gradient descent with L2 regularization — no external dependency. Runs in
// milliseconds at this dataset size; would need a real library long before that stops
// being true.
function trainLogisticRegression(X: number[][], y: number[], epochs = 800, lr = 0.3, l2 = 0.02): { weights: number[]; bias: number } {
  const n = X.length;
  const d = X[0].length;
  let weights = new Array(d).fill(0);
  let bias = 0;
  for (let epoch = 0; epoch < epochs; epoch++) {
    const gradW = new Array(d).fill(0);
    let gradB = 0;
    for (let i = 0; i < n; i++) {
      const z = X[i].reduce((s, x, j) => s + x * weights[j], bias);
      const err = sigmoid(z) - y[i];
      for (let j = 0; j < d; j++) gradW[j] += err * X[i][j];
      gradB += err;
    }
    weights = weights.map((w, j) => w - lr * (gradW[j] / n + l2 * w));
    bias -= lr * (gradB / n);
  }
  return { weights, bias };
}

export interface TrainResult {
  trained: boolean;
  reason?: string;
  model?: MLModel;
}

export function trainModel(): TrainResult {
  const rows = listAllDuplicatasForTraining();
  if (rows.length < MIN_TRAINING_SAMPLES) {
    return { trained: false, reason: `Apenas ${rows.length} duplicata(s) na base — mínimo de ${MIN_TRAINING_SAMPLES} para treinar sem apenas memorizar ruído.` };
  }
  const X = rows.map(extractFeatures);
  const y = rows.map(labelFor);
  const nPositive = y.reduce((s, v) => s + v, 0);
  if (nPositive === 0 || nPositive === y.length) {
    return { trained: false, reason: 'Todos os exemplos têm o mesmo resultado (nenhum sinistro/recuperação registrado ainda) — nada para o modelo aprender a distinguir.' };
  }

  const { Xs, means, stds } = standardize(X);
  const { weights, bias } = trainLogisticRegression(Xs, y);

  const predictions = Xs.map((row) => (sigmoid(row.reduce((s, x, j) => s + x * weights[j], bias)) >= 0.5 ? 1 : 0));
  const correct = predictions.filter((p, i) => p === y[i]).length;
  const trainAccuracy = correct / y.length;

  const model: MLModel = {
    weights,
    bias,
    featureNames: FEATURE_NAMES,
    featureMeans: means,
    featureStds: stds,
    nSamples: rows.length,
    nPositive,
    trainAccuracy,
    trainedAt: new Date().toISOString(),
  };
  setPlatformSetting(MODEL_KEY, JSON.stringify(model));
  logger.info({ nSamples: rows.length, nPositive, trainAccuracy }, '[ml-scoring] modelo retreinado');
  return { trained: true, model };
}

export function getModel(): MLModel | null {
  const raw = getPlatformSetting(MODEL_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as MLModel;
  } catch {
    return null;
  }
}

// Probability of a bad outcome (0-1), or null when no model has been trained yet — callers
// (riscoCore.ts) must treat null as "no ML signal available", never as 0.
export function predictDefaultProbability(d: DuplicataRow): number | null {
  const model = getModel();
  if (!model) return null;
  const features = extractFeatures(d);
  const standardized = features.map((v, j) => (v - model.featureMeans[j]) / model.featureStds[j]);
  const z = standardized.reduce((s, x, j) => s + x * model.weights[j], model.bias);
  return sigmoid(z);
}
