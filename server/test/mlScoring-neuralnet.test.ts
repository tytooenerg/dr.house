import { describe, expect, it, beforeAll } from 'vitest';
import { seedIfEmpty } from '../src/db/seed.js';
import { createUser } from '../src/db/users.js';
import { createDuplicata, setComplianceScore, setSinistroStatus } from '../src/db/duplicatas.js';
import { trainModel, predictDefaultProbability, MIN_NEURAL_NET_SAMPLES } from '../src/lib/mlScoring.js';
import type { DuplicataRow } from '../src/db/types.js';

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// Real, honest opinion this closes: a neural net is only worth training once there's
// enough real volume to not just memorize noise (see the chat answer to "vale a pena
// colocar uma rede neural?"). This builds exactly MIN_NEURAL_NET_SAMPLES+ real duplicatas
// with a genuinely learnable pattern (low compliance score + no seguro → higher chance of
// a real sinistro) so the MLP path actually has something non-trivial to fit, rather than
// asserting it merely "ran".
describe('ML scoring — neural net upgrade, gated by real data volume', () => {
  it('trains a logistic-regression model, not an MLP, below the volume threshold', () => {
    const cedente = createUser({ email: `mlp-small-ced-${unique()}@example.com`, passwordHash: 'x', nome: 'T', companyName: 'Small Co', role: 'cedente' });
    for (let i = 0; i < 20; i++) {
      const bad = i % 2 === 0;
      const d = createDuplicata({
        cedenteId: cedente.id,
        cedenteNome: cedente.company_name,
        sacadoNome: 'Sacado MLP Small',
        sacadoCnpj: '',
        valor: 20000,
        vencimento: '2026-12-31',
        emissao: '10/08/2026',
        status: 'aprovada',
        lastroPct: 100,
        seguro: !bad,
        id: `DUP-MLPSMALL-${unique()}-${i}`,
      });
      setComplianceScore(d.id, bad ? 20 : 80);
      if (bad) setSinistroStatus(d.id, 'aprovado', 'teste');
    }

    const result = trainModel();
    expect(result.trained).toBe(true);
    expect(result.model!.kind).toBe('logistic');
    expect(result.model!.mlp).toBeUndefined();
  });

  it('trains a real MLP once volume clears MIN_NEURAL_NET_SAMPLES, with sane predictions and feature importance', () => {
    const cedente = createUser({ email: `mlp-big-ced-${unique()}@example.com`, passwordHash: 'x', nome: 'T', companyName: 'Big Co', role: 'cedente' });
    const total = MIN_NEURAL_NET_SAMPLES + 10;
    const rows: DuplicataRow[] = [];
    for (let i = 0; i < total; i++) {
      const bad = i % 3 === 0; // a real, if simple, learnable pattern — not random noise
      const d = createDuplicata({
        cedenteId: cedente.id,
        cedenteNome: cedente.company_name,
        sacadoNome: 'Sacado MLP Big',
        sacadoCnpj: '',
        valor: 15000 + i,
        vencimento: '2026-12-31',
        emissao: '10/08/2026',
        status: 'aprovada',
        lastroPct: 100,
        seguro: !bad,
        id: `DUP-MLPBIG-${unique()}-${i}`,
      });
      setComplianceScore(d.id, bad ? 15 : 85);
      if (bad) setSinistroStatus(d.id, 'aprovado', 'teste');
      rows.push(d);
    }

    const result = trainModel();
    expect(result.trained).toBe(true);
    expect(result.model!.kind).toBe('mlp');
    expect(result.model!.mlp).toBeDefined();
    expect(result.model!.nSamples).toBeGreaterThanOrEqual(MIN_NEURAL_NET_SAMPLES);
    // A real, learnable pattern this size should train to noticeably better than chance.
    expect(result.model!.trainAccuracy).toBeGreaterThan(0.6);

    // Feature importance is real (permutation-based), not fabricated — sums to ~1 and
    // covers every feature the model actually uses.
    expect(result.model!.featureImportance).toHaveLength(5);
    const totalImportance = result.model!.featureImportance!.reduce((s, f) => s + f.importance, 0);
    expect(totalImportance).toBeCloseTo(1, 1);

    // Prediction still returns a real, bounded probability for both a "good" and "bad" case.
    const goodDup = { ...rows[1] }; // seguro=1, compliance_score=85 pattern
    const badDup = { ...rows[0] }; // seguro=0, compliance_score=15 pattern
    const pGood = predictDefaultProbability(goodDup);
    const pBad = predictDefaultProbability(badDup);
    expect(pGood).not.toBeNull();
    expect(pBad).not.toBeNull();
    expect(pGood!).toBeGreaterThanOrEqual(0);
    expect(pGood!).toBeLessThanOrEqual(1);
    // The model should have learned the real pattern: the "bad" profile predicts higher risk.
    expect(pBad!).toBeGreaterThan(pGood!);
  });
});
