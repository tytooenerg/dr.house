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

export interface MlpWeights {
  w1: number[][]; // hidden units x input features
  b1: number[];
  w2: number[]; // output x hidden
  b2: number;
}

export interface FeatureImportance {
  name: string;
  importance: number; // 0-1, relative — see computeFeatureImportance's permutation method
}

export interface MLModel {
  // 'logistic' (the only kind that ever existed until now) below MIN_NEURAL_NET_SAMPLES;
  // 'mlp' once there's real enough volume to justify one — see the module comment below.
  kind: 'logistic' | 'mlp';
  weights?: number[]; // logistic only
  bias?: number; // logistic only
  mlp?: MlpWeights; // mlp only
  featureImportance?: FeatureImportance[]; // mlp only — logistic's own weights already ARE its importances
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
// Below this, a neural net would overfit a handful of parameters onto noise (this is a
// demo-scale dataset today — see the opinion given in chat when asked "vale a pena colocar
// uma rede neural no sistema?"). Logistic regression stays the only model below this line,
// exactly as it always was; the MLP only ever kicks in with real volume to justify it, and
// falls back to logistic automatically if volume ever drops back below the line (e.g. after
// a database reset). Same "real when the precondition is met, honest fallback otherwise"
// discipline as every real-when-configured integration elsewhere in this codebase — the
// precondition here is data volume, not an env var.
export const MIN_NEURAL_NET_SAMPLES = 500;
const HIDDEN_UNITS = 6;
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

// One hidden layer, sigmoid activations throughout, plain backprop — same "no external ML
// dependency, auditable line by line" reasoning as trainLogisticRegression above. Only
// ever invoked once trainModel() has confirmed real volume (MIN_NEURAL_NET_SAMPLES).
function trainMlp(X: number[][], y: number[], epochs = 600, lr = 0.15, l2 = 0.01): MlpWeights {
  const n = X.length;
  const d = X[0].length;
  const h = HIDDEN_UNITS;
  const w1 = Array.from({ length: h }, () => Array.from({ length: d }, () => (Math.random() - 0.5) * Math.sqrt(2 / d)));
  const b1 = new Array(h).fill(0);
  const w2 = Array.from({ length: h }, () => (Math.random() - 0.5) * Math.sqrt(2 / h));
  let b2 = 0;

  for (let epoch = 0; epoch < epochs; epoch++) {
    const gW1 = w1.map((row) => row.map(() => 0));
    const gB1 = new Array(h).fill(0);
    const gW2 = new Array(h).fill(0);
    let gB2 = 0;
    for (let i = 0; i < n; i++) {
      const x = X[i];
      const aHidden = w1.map((row, k) => sigmoid(row.reduce((s, wv, j) => s + wv * x[j], b1[k])));
      const pred = sigmoid(aHidden.reduce((s, a, k) => s + a * w2[k], b2));
      const errOut = pred - y[i];
      for (let k = 0; k < h; k++) gW2[k] += errOut * aHidden[k];
      gB2 += errOut;
      for (let k = 0; k < h; k++) {
        const dHidden = errOut * w2[k] * aHidden[k] * (1 - aHidden[k]);
        for (let j = 0; j < d; j++) gW1[k][j] += dHidden * x[j];
        gB1[k] += dHidden;
      }
    }
    for (let k = 0; k < h; k++) {
      for (let j = 0; j < d; j++) w1[k][j] -= lr * (gW1[k][j] / n + l2 * w1[k][j]);
      b1[k] -= lr * (gB1[k] / n);
      w2[k] -= lr * (gW2[k] / n + l2 * w2[k]);
    }
    b2 -= lr * (gB2 / n);
  }
  return { w1, b1, w2, b2 };
}

function predictMlp(mlp: MlpWeights, xStd: number[]): number {
  const aHidden = mlp.w1.map((row, k) => sigmoid(row.reduce((s, wv, j) => s + wv * xStd[j], mlp.b1[k])));
  return sigmoid(aHidden.reduce((s, a, k) => s + a * mlp.w2[k], mlp.b2));
}

// Real (if simple) explainability for the MLP: permutation importance — replace one
// feature at a time with the sample mean (0 in standardized space, i.e. "no information
// from this feature") across every row, measure how much mean absolute prediction shift
// that causes, normalize to sum to 1. Not SHAP, but a real, honestly-computed number, not
// a guess — the same "explainable, not a black box" bar this codebase already holds
// logistic regression's own coefficients to.
function computeFeatureImportance(mlp: MlpWeights, Xs: number[][]): FeatureImportance[] {
  const basePreds = Xs.map((row) => predictMlp(mlp, row));
  const shifts = FEATURE_NAMES.map((_, j) => {
    const permuted = Xs.map((row) => row.map((v, k) => (k === j ? 0 : v)));
    const permutedPreds = permuted.map((row) => predictMlp(mlp, row));
    const meanShift = permutedPreds.reduce((s, p, i) => s + Math.abs(p - basePreds[i]), 0) / permutedPreds.length;
    return meanShift;
  });
  const total = shifts.reduce((s, v) => s + v, 0) || 1;
  return FEATURE_NAMES.map((name, j) => ({ name, importance: shifts[j] / total })).sort((a, b) => b.importance - a.importance);
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

  let model: MLModel;
  if (rows.length >= MIN_NEURAL_NET_SAMPLES) {
    const mlp = trainMlp(Xs, y);
    const predictions = Xs.map((row) => (predictMlp(mlp, row) >= 0.5 ? 1 : 0));
    const trainAccuracy = predictions.filter((p, i) => p === y[i]).length / y.length;
    model = {
      kind: 'mlp',
      mlp,
      featureImportance: computeFeatureImportance(mlp, Xs),
      featureNames: FEATURE_NAMES,
      featureMeans: means,
      featureStds: stds,
      nSamples: rows.length,
      nPositive,
      trainAccuracy,
      trainedAt: new Date().toISOString(),
    };
  } else {
    const { weights, bias } = trainLogisticRegression(Xs, y);
    const predictions = Xs.map((row) => (sigmoid(row.reduce((s, x, j) => s + x * weights[j], bias)) >= 0.5 ? 1 : 0));
    const trainAccuracy = predictions.filter((p, i) => p === y[i]).length / y.length;
    model = {
      kind: 'logistic',
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
  }

  setPlatformSetting(MODEL_KEY, JSON.stringify(model));
  logger.info({ nSamples: rows.length, nPositive, trainAccuracy: model.trainAccuracy, kind: model.kind }, '[ml-scoring] modelo retreinado');
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
  if (model.kind === 'mlp' && model.mlp) return predictMlp(model.mlp, standardized);
  const z = standardized.reduce((s, x, j) => s + x * (model.weights?.[j] ?? 0), model.bias ?? 0);
  return sigmoid(z);
}
