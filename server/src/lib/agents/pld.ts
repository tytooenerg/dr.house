import { screenEntity } from '../../db/sanctions.js';
import { screenJudicialRecords } from '../judicialRecords.js';
import { listRecentComplianceAlerts } from '../../db/complianceAlerts.js';
import { createComplianceAlert } from '../../db/complianceAlerts.js';
import { getUserById, setPldStatus } from '../../db/users.js';
import { recordAuditEvent } from '../../db/audit.js';
import { runFraudAnomalyScan } from '../fraudAnomalyDetection.js';
import type { AgentDefinition } from '../agentRuntime.js';

export const pldAgent: AgentDefinition = {
  id: 'pld',
  label: 'Agente de PLD/AML',
  description: 'Investiga sanções, PEP, histórico judicial e padrões de fraude na rede de uma contraparte e, quando há evidência real, sinaliza a conta para revisão de compliance.',
  systemPrompt: `Você é um analista de prevenção à lavagem de dinheiro e fraude (PLD/AML) da Lastro. Investigue a empresa/contraparte informada usando as ferramentas disponíveis — triagem de sanções/PEP, histórico judicial, alertas de compliance e padrões de fraude na rede (concentração anômala de sacado, autorrelacionamento). Nunca invente uma correspondência que as ferramentas não retornaram. Só chame sinalizar_pld quando houver evidência real e concreta (não uma suspeita vaga) de risco — essa ação sinaliza a conta e abre um alerta crítico para um analista humano decidir os próximos passos (incluindo eventual reporte ao COAF), então explique exatamente qual evidência te levou a essa decisão. Ao final, resuma o que encontrou e sua recomendação.`,
  tools: [
    {
      name: 'triagem_sancoes',
      description: 'Triagem contra listas de sanções (OFAC/Lista Consolidada do CSNU, quando SANCTIONS_LIVE_FEED estiver configurado) e PEP.',
      inputSchema: { type: 'object', properties: { nome: { type: 'string' }, cnpj: { type: 'string' } }, required: ['nome', 'cnpj'] },
      handler: async (input: { nome: string; cnpj: string }, ctx) => (await screenEntity(input.nome, input.cnpj, ctx.userId)) ?? { match: false },
    },
    {
      name: 'consultar_historico_judicial',
      description: 'Processos judiciais (execução/falência/recuperação) contra o CNPJ.',
      inputSchema: { type: 'object', properties: { cnpj: { type: 'string' } }, required: ['cnpj'] },
      handler: async (input: { cnpj: string }) => (await screenJudicialRecords(input.cnpj)) ?? { disponivel: false },
    },
    {
      name: 'listar_alertas_recentes',
      description: 'Lista os alertas de compliance mais recentes já registrados na plataforma (duplicidade, valor anômalo, triagem PLD).',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => listRecentComplianceAlerts(15),
    },
    {
      name: 'detectar_anomalias_de_rede',
      description:
        'Roda a detecção de fraude por anomalia de rede sobre toda a base (concentração anômala de sacado, autorrelacionamento) e retorna os achados relacionados a uma empresa específica.',
      inputSchema: { type: 'object', properties: { companyName: { type: 'string', description: 'Nome da empresa (cedente ou sacado) a filtrar' } }, required: ['companyName'] },
      handler: async (input: { companyName: string }) => {
        const norm = input.companyName.trim().toLowerCase();
        const findings = runFraudAnomalyScan().filter((f) => f.cedenteNome.toLowerCase().includes(norm) || f.sacadoNome.toLowerCase().includes(norm));
        return { achados: findings };
      },
    },
    {
      name: 'sinalizar_pld',
      description: 'Marca a conta como PLD sinalizada e abre um alerta de compliance crítico, com base em evidência real levantada nesta investigação. Ação sensível.',
      sensitive: true,
      inputSchema: {
        type: 'object',
        properties: { userId: { type: 'number' }, descricao: { type: 'string', description: 'Evidência concreta que justifica a sinalização' } },
        required: ['userId', 'descricao'],
      },
      handler: async (input: { userId: number; descricao: string }) => {
        const user = getUserById(input.userId);
        if (!user) throw new Error('Conta não encontrada.');
        setPldStatus(input.userId, 'flagged', input.descricao);
        createComplianceAlert({ type: 'pld_screening', severity: 'critico', message: input.descricao, userId: input.userId });
        recordAuditEvent(input.userId, user.company_name, 'pld.sinalizado_por_agente_ia', { descricao: input.descricao });
        return { ok: true };
      },
    },
  ],
};
