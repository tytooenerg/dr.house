import type { AgentDefinition } from '../agentRuntime.js';
import { emissaoAgent } from './emissao.js';
import { underwritingAgent } from './underwriting.js';
import { pldAgent } from './pld.js';
import { cobrancaAgent } from './cobranca.js';
import { disputaSinistroAgent } from './disputaSinistro.js';
import { regulatorioAgent } from './regulatorio.js';
import { onboardingAgent } from './onboarding.js';
import { autoBidAgent } from './autoBid.js';
import { suporteAgent } from './suporte.js';
import { comercialAgent } from './comercial.js';

// The 10 agentic AI deployments — every one wraps real Lastro data/pipelines (never
// fabricated tool results) behind the shared tool-use loop in lib/agentRuntime.ts. Any
// write with real consequence (money, a compliance/KYB decision, an official legal or
// regulatory record) is marked `sensitive` on its tool and gated behind human approval —
// see routes/agents.ts.
export const AGENTS: Record<string, AgentDefinition> = {
  [emissaoAgent.id]: emissaoAgent,
  [underwritingAgent.id]: underwritingAgent,
  [pldAgent.id]: pldAgent,
  [cobrancaAgent.id]: cobrancaAgent,
  [disputaSinistroAgent.id]: disputaSinistroAgent,
  [regulatorioAgent.id]: regulatorioAgent,
  [onboardingAgent.id]: onboardingAgent,
  [autoBidAgent.id]: autoBidAgent,
  [suporteAgent.id]: suporteAgent,
  [comercialAgent.id]: comercialAgent,
};

export function listAgentSummaries() {
  return Object.values(AGENTS).map((a) => ({
    id: a.id,
    label: a.label,
    description: a.description,
    tools: a.tools.map((t) => ({ name: t.name, description: t.description, sensitive: !!t.sensitive })),
  }));
}

export function getAgent(id: string): AgentDefinition | undefined {
  return AGENTS[id];
}
