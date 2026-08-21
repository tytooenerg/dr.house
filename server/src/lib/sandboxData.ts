import { createDuplicata } from '../db/duplicatas.js';
import { db } from '../db/index.js';
import type { UserRow } from '../db/types.js';
import { logger } from './logger.js';

// Real, isolated demo dataset for a newly generated test-mode partner API key — closes
// the "sandbox keys don't have their own seeded, isolated dataset" gap (see README
// "Known gaps"). Every row created here is tagged sandbox=1 — filtered out of every
// live/internal read at the query layer (db/duplicatas.ts) — so a partner exploring
// /api/v1 in test mode has something meaningful to GET immediately, without any of it
// ever mixing with real account data or a real duplicata's registro.
export function ensureSandboxDataset(user: UserRow) {
  if (user.role !== 'cedente') return; // only cedente accounts emit duplicatas today
  const existing = db.prepare('SELECT COUNT(*) as n FROM duplicatas WHERE cedente_id = ? AND sandbox = 1').get(user.id) as { n: number };
  if (existing.n > 0) return;

  const emissao = new Date().toLocaleDateString('pt-BR');
  createDuplicata({
    cedenteId: user.id,
    cedenteNome: user.company_name,
    sacadoNome: 'Sandbox Comércio Demo Ltda',
    sacadoCnpj: '00.000.000/0001-00',
    valor: 25000,
    vencimento: new Date(Date.now() + 30 * 86_400_000).toLocaleDateString('pt-BR'),
    emissao,
    status: 'aprovada',
    lastroPct: 100,
    seguro: false,
    registro: `SANDBOX-SEED-${user.id}-1`,
    registradora: null,
    sandbox: true,
  });
  createDuplicata({
    cedenteId: user.id,
    cedenteNome: user.company_name,
    sacadoNome: 'Sandbox Indústria Demo S.A.',
    sacadoCnpj: '00.000.000/0002-00',
    valor: 48000,
    vencimento: new Date(Date.now() + 45 * 86_400_000).toLocaleDateString('pt-BR'),
    emissao,
    status: 'no_mercado',
    lastroPct: 100,
    seguro: false,
    registro: `SANDBOX-SEED-${user.id}-2`,
    registradora: null,
    sandbox: true,
  });
  logger.info({ userId: user.id }, '[sandbox] dataset de teste seedado para nova chave sandbox');
}
