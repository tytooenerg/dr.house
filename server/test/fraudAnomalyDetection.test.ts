import { describe, expect, it, beforeAll } from 'vitest';
import { seedIfEmpty } from '../src/db/seed.js';
import { createDuplicata } from '../src/db/duplicatas.js';
import { createUser } from '../src/db/users.js';
import { detectConcentracaoAnomala, detectAutorrelacionamento, runFraudAnomalyScan } from '../src/lib/fraudAnomalyDetection.js';

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// duplicatas.cedente_id is a real FK to users(id) — every test case needs a real account
// behind it, not an arbitrary made-up number.
function makeCedente(companyName: string): number {
  return createUser({ email: `fraud-${unique()}@example.com`, passwordHash: 'x', nome: 'Teste', companyName, role: 'cedente' }).id;
}

describe('fraud anomaly detection — concentração', () => {
  it('flags a cedente whose volume is almost entirely concentrated in one sacado', () => {
    const cedenteNome = `Cedente Concentrado ${unique()}`;
    const cedenteId = makeCedente(cedenteNome);
    const sacadoNome = `Sacado Único ${unique()}`;
    for (let i = 0; i < 4; i++) {
      createDuplicata({
        cedenteId,
        cedenteNome,
        sacadoNome,
        sacadoCnpj: '11.111.111/0001-11',
        valor: 40_000,
        vencimento: '2030-01-01',
        emissao: '01/01/2026',
        status: 'aprovada',
        lastroPct: 90,
        seguro: false,
        id: `DUP-FRAUDTEST-${unique()}-${i}`,
      });
    }
    const findings = detectConcentracaoAnomala();
    const match = findings.find((f) => f.cedenteId === cedenteId);
    expect(match).toBeDefined();
    expect(match!.tipo).toBe('concentracao_anomala');
    expect(match!.sacadoNome).toBe(sacadoNome);
  });

  it('does not flag a cedente with a genuinely diversified book', () => {
    const cedenteNome = `Cedente Diversificado ${unique()}`;
    const cedenteId = makeCedente(cedenteNome);
    for (let i = 0; i < 4; i++) {
      createDuplicata({
        cedenteId,
        cedenteNome,
        sacadoNome: `Sacado Diverso ${i} ${unique()}`,
        sacadoCnpj: `22.222.222/000${i}-22`,
        valor: 40_000,
        vencimento: '2030-01-01',
        emissao: '01/01/2026',
        status: 'aprovada',
        lastroPct: 90,
        seguro: false,
        id: `DUP-FRAUDTEST-DIV-${unique()}-${i}`,
      });
    }
    const findings = detectConcentracaoAnomala();
    expect(findings.some((f) => f.cedenteId === cedenteId)).toBe(false);
  });
});

describe('fraud anomaly detection — autorrelacionamento', () => {
  it('flags a duplicata where sacado and cedente share the exact same name', () => {
    const nome = `Empresa Espelho ${unique()}`;
    const cedenteId = makeCedente(nome);
    const id = `DUP-FRAUDTEST-SELF-${unique()}`;
    createDuplicata({
      cedenteId,
      cedenteNome: nome,
      sacadoNome: nome,
      sacadoCnpj: '33.333.333/0001-33',
      valor: 10_000,
      vencimento: '2030-01-01',
      emissao: '01/01/2026',
      status: 'aprovada',
      lastroPct: 90,
      seguro: false,
      id,
    });
    const findings = detectAutorrelacionamento();
    expect(findings.some((f) => f.evidencia.duplicataId === id)).toBe(true);
  });

  it('does not flag a normal duplicata with distinct cedente/sacado names', () => {
    const id = `DUP-FRAUDTEST-NORMAL-${unique()}`;
    const cedenteId = makeCedente(`Vendedor ${unique()}`);
    createDuplicata({
      cedenteId,
      cedenteNome: `Vendedor ${unique()}`,
      sacadoNome: `Comprador ${unique()}`,
      sacadoCnpj: '44.444.444/0001-44',
      valor: 10_000,
      vencimento: '2030-01-01',
      emissao: '01/01/2026',
      status: 'aprovada',
      lastroPct: 90,
      seguro: false,
      id,
    });
    const findings = detectAutorrelacionamento();
    expect(findings.some((f) => f.evidencia.duplicataId === id)).toBe(false);
  });
});

describe('runFraudAnomalyScan', () => {
  it('combines both detectors', () => {
    const findings = runFraudAnomalyScan();
    expect(Array.isArray(findings)).toBe(true);
    for (const f of findings) {
      expect(['concentracao_anomala', 'autorrelacionamento']).toContain(f.tipo);
    }
  });
});
