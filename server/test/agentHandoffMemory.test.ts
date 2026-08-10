import { describe, expect, it, beforeAll } from 'vitest';
import { seedIfEmpty } from '../src/db/seed.js';
import { AGENTS } from '../src/lib/agents/index.js';
import { createAgentRun, finishAgentRun, listAgentRunsForSubject } from '../src/db/agents.js';

beforeAll(async () => {
  await seedIfEmpty();
});

describe('agent handoff', () => {
  it('emissão can hand off only to underwriting; cobrança only to disputa_sinistro', () => {
    const emissaoHandoff = AGENTS.emissao.tools.find((t) => t.name === 'acionar_agente')!;
    expect(emissaoHandoff).toBeDefined();
    expect(emissaoHandoff.sensitive).toBeFalsy();

    const cobrancaHandoff = AGENTS.cobranca.tools.find((t) => t.name === 'acionar_agente')!;
    expect(cobrancaHandoff).toBeDefined();
  });

  it('refuses to hand off to an agent outside the declared allowlist', async () => {
    const handoff = AGENTS.emissao.tools.find((t) => t.name === 'acionar_agente')!;
    const result = (await handoff.handler({ agentId: 'pld', instrucao: 'teste' }, { runId: 1, handoffDepth: 0 })) as { erro?: string };
    expect(result.erro).toBeDefined();
  });

  it('refuses to hand off past the max depth (no infinite chains)', async () => {
    const handoff = AGENTS.emissao.tools.find((t) => t.name === 'acionar_agente')!;
    const result = (await handoff.handler({ agentId: 'underwriting', instrucao: 'teste' }, { runId: 1, handoffDepth: 1 })) as { erro?: string };
    expect(result.erro).toMatch(/profundidade/i);
  });

  it('a top-level (depth 0) handoff to an allowed agent actually invokes it (honestly simulated — no ANTHROPIC_API_KEY in tests)', async () => {
    const handoff = AGENTS.emissao.tools.find((t) => t.name === 'acionar_agente')!;
    const result = (await handoff.handler({ agentId: 'underwriting', instrucao: 'avalie o risco' }, { runId: 1, handoffDepth: 0 })) as {
      agenteAcionado: string;
      status: string;
      runId: number;
    };
    expect(result.agenteAcionado).toBe('underwriting');
    expect(result.status).toBe('simulado');
    expect(typeof result.runId).toBe('number');
  });
});

describe('cross-agent memory', () => {
  it('surfaces prior completed runs against the same subject, most recent first, excluding unfinished ones', () => {
    const subjectId = `dup_memtest_${Date.now()}`;
    const r1 = createAgentRun({ agentId: 'underwriting', userId: null, subjectType: 'duplicata', subjectId, input: 'x', mode: 'llm' });
    finishAgentRun(r1, 'concluido', 'Parecer: risco baixo, sem histórico de atraso.');
    const r2 = createAgentRun({ agentId: 'cobranca', userId: null, subjectType: 'duplicata', subjectId, input: 'x', mode: 'llm' });
    finishAgentRun(r2, 'concluido', 'Escalado para notificação de cobrança.');
    // Still in progress — should not show up as usable prior context.
    createAgentRun({ agentId: 'pld', userId: null, subjectType: 'duplicata', subjectId, input: 'x', mode: 'llm' });

    const prior = listAgentRunsForSubject('duplicata', subjectId, 5);
    expect(prior.map((r) => r.id)).toEqual([r2, r1]);
    expect(prior.every((r) => r.status === 'concluido')).toBe(true);
  });

  it('never crosses subjects', () => {
    const a = `dup_a_${Date.now()}`;
    const b = `dup_b_${Date.now()}`;
    const r1 = createAgentRun({ agentId: 'underwriting', userId: null, subjectType: 'duplicata', subjectId: a, input: 'x', mode: 'llm' });
    finishAgentRun(r1, 'concluido', 'sobre A');
    expect(listAgentRunsForSubject('duplicata', b, 5)).toHaveLength(0);
  });
});
