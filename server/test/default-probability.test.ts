import { describe, expect, it, beforeAll } from 'vitest';
import { seedIfEmpty } from '../src/db/seed.js';
import { createDuplicata, setSinistroStatus } from '../src/db/duplicatas.js';
import { trainModel } from '../src/lib/mlScoring.js';
import { estimateDefaultProbability, ASSUMED_PD_BY_RATING } from '../src/lib/defaultProbability.js';

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

describe('estimateDefaultProbability — single source of truth for PD, shared by the stress test and the underwriting agent', () => {
  it('falls back to the documented assumed prior by rating when no ML model is trained', () => {
    const d = createDuplicata({
      cedenteId: null,
      cedenteNome: 'Cedente PD Teste',
      sacadoNome: `Sacado PD Assumida ${unique()}`,
      sacadoCnpj: '',
      valor: 10000,
      vencimento: '2026-12-31',
      emissao: '10/08/2026',
      status: 'aprovada',
      lastroPct: 100,
      seguro: false,
    });
    const estimate = estimateDefaultProbability(d);
    expect(estimate.source).toBe('assumed');
    expect(estimate.pd).toBe(ASSUMED_PD_BY_RATING[estimate.rating]);
  });

  it('uses the real trained ML model once enough labeled samples exist, instead of the assumed prior', () => {
    // Build a real, learnable labeled dataset — same shape mlScoring.test.ts uses — so
    // trainModel() actually trains rather than refusing for lack of data.
    for (let i = 0; i < 15; i++) {
      const bad = createDuplicata({
        cedenteId: null,
        cedenteNome: 'Cedente PD Teste',
        sacadoNome: `Sacado PD Ruim ${unique()}`,
        sacadoCnpj: '',
        valor: 20000,
        vencimento: '2026-01-10',
        emissao: '10/12/2025',
        status: 'aprovada',
        lastroPct: 100,
        seguro: false,
      });
      setSinistroStatus(bad.id, 'aprovado', 'teste');
      createDuplicata({
        cedenteId: null,
        cedenteNome: 'Cedente PD Teste',
        sacadoNome: `Sacado PD Bom ${unique()}`,
        sacadoCnpj: '',
        valor: 20000,
        vencimento: '2026-12-31',
        emissao: '10/08/2026',
        status: 'aprovada',
        lastroPct: 100,
        seguro: true,
      });
    }
    const trained = trainModel();
    expect(trained.trained).toBe(true);

    const d = createDuplicata({
      cedenteId: null,
      cedenteNome: 'Cedente PD Teste',
      sacadoNome: `Sacado PD Pós-Treino ${unique()}`,
      sacadoCnpj: '',
      valor: 15000,
      vencimento: '2026-12-31',
      emissao: '10/08/2026',
      status: 'aprovada',
      lastroPct: 100,
      seguro: false,
    });
    const estimate = estimateDefaultProbability(d);
    expect(estimate.source).toBe('ml');
    expect(estimate.pd).toBeGreaterThanOrEqual(0);
    expect(estimate.pd).toBeLessThanOrEqual(1);
  });
});
