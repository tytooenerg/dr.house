import { registerAgentRegistry, type AgentDefinition } from '../agentRuntime.js';
import type { Role } from '../../db/types.js';
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
import { marketMakerAgent } from './marketMaker.js';
import { reconciliationAgent } from './reconciliation.js';

// The 12 agentic AI deployments — every one wraps real Lastro data/pipelines (never
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
  [reconciliationAgent.id]: reconciliationAgent,
  [marketMakerAgent.id]: marketMakerAgent,
};

// Lets agentRuntime.ts's handoff tool (createHandoffTool) call another agent by id without
// this module and agentRuntime.ts importing each other — see the comment there.
registerAgentRegistry(AGENTS);

// Admins see every agent regardless of role. Everyone else only sees the ones whose
// selfServiceRoles include their role — and only ever in the context of their own account,
// enforced server-side in routes/agents.ts, never by what this listing merely omits.
export function listAgentSummaries(role?: Role) {
  return Object.values(AGENTS)
    .filter((a) => !role || role === 'admin' || (a.selfServiceRoles ?? []).includes(role))
    .map((a) => ({
      id: a.id,
      label: a.label,
      description: a.description,
      selfService: !!role && role !== 'admin',
      tools: a.tools.map((t) => ({ name: t.name, description: t.description, sensitive: !!t.sensitive, selfApprovable: !!t.selfApprovable })),
    }));
}

export function canRunSelfService(def: AgentDefinition, role: Role): boolean {
  return (def.selfServiceRoles ?? []).includes(role);
}

export function getAgent(id: string): AgentDefinition | undefined {
  return AGENTS[id];
}
