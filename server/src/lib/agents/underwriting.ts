import { buildBlendedRiscoView } from '../riscoCore.js';
import { consultarBureau } from '../creditBureau.js';
import { screenJudicialRecords } from '../judicialRecords.js';
import { consultarFluxoDeCaixa } from '../openFinance.js';
import { getModel, predictDefaultProbability, MIN_TRAINING_SAMPLES } from '../mlScoring.js';
import { getDuplicata } from '../../db/duplicatas.js';
import type { AgentDefinition } from '../agentRuntime.js';

// Advisory-only by design — every tool here is read-only, nothing is sensitive/gated,
// because this agent never changes anything; it investigates across five independent
// sources (internal+network score, external bureau, judicial records, Open Finance, and a
// real trained ML model — lib/mlScoring.ts) and hands back a reasoned parecer. That's
// already the upgrade over the old fixed formula in riscoCore.ts (a static weighted blend
// that always runs the same order regardless of what each source actually says) — the
// model can decide which sources are worth consulting and reason over conflicting signals
// across them.
export const underwritingAgent: AgentDefinition = {
  id: 'underwriting',
  label: 'Agente de Underwriting',
  description: 'Investiga score interno, bureau externo, histórico judicial, fluxo de caixa e o modelo de ML treinado de um sacado e produz um parecer de risco fundamentado.',
  systemPrompt: `Você é um analista de crédito sênior investigando o risco de uma empresa sacada (devedora de duplicatas) para orientar um investidor. Você tem acesso a cinco fontes independentes de dados via ferramentas — use as que forem relevantes (nem sempre todas terão dado disponível, o que também é informação relevante; o modelo de ML em particular só fica disponível depois que a base tiver amostras suficientes de resultado real). Nunca invente fatos que as ferramentas não retornaram. Ao final, escreva um parecer objetivo em português (4-8 frases) cobrindo: nível de risco, principais fatores observados, e qualquer divergência entre as fontes que mereça atenção humana antes de decidir.`,
  tools: [
    {
      name: 'consultar_score_interno',
      description: 'Score de risco combinado (interno da Lastro + sinais de rede de parceiros) de um CNPJ.',
      inputSchema: { type: 'object', properties: { cnpj: { type: 'string' } }, required: ['cnpj'] },
      handler: async (input: { cnpj: string }, ctx) => (await buildBlendedRiscoView(input.cnpj, ctx.userId)) ?? { encontrado: false },
    },
    {
      name: 'consultar_bureau_externo',
      description: 'Score de bureau de crédito externo (Serasa/Boa Vista/Quod) — real quando BUREAU_API_URL/KEY estiverem configurados; retorna indisponível caso contrário.',
      inputSchema: { type: 'object', properties: { cnpj: { type: 'string' } }, required: ['cnpj'] },
      handler: async (input: { cnpj: string }) => (await consultarBureau(input.cnpj)) ?? { disponivel: false },
    },
    {
      name: 'consultar_historico_judicial',
      description: 'Processos de execução/falência/recuperação judicial contra o CNPJ — real quando JUDICIAL_RECORDS_API_URL/KEY configurados.',
      inputSchema: { type: 'object', properties: { cnpj: { type: 'string' } }, required: ['cnpj'] },
      handler: async (input: { cnpj: string }) => (await screenJudicialRecords(input.cnpj)) ?? { disponivel: false },
    },
    {
      name: 'consultar_fluxo_de_caixa',
      description: 'Sinal de fluxo de caixa via Open Finance (receita média mensal, volatilidade) — real quando há consentimento do sacado e OPEN_FINANCE_API_URL/KEY configurados.',
      inputSchema: { type: 'object', properties: { cnpj: { type: 'string' } }, required: ['cnpj'] },
      handler: async (input: { cnpj: string }) => (await consultarFluxoDeCaixa(input.cnpj)) ?? { disponivel: false },
    },
    {
      name: 'prever_probabilidade_ml',
      description:
        'Probabilidade de resultado ruim (sinistro aprovado ou necessidade de recuperação jurídica) segundo um modelo de regressão logística treinado sobre o histórico real de duplicatas da Lastro. Retorna indisponível se ainda não houver amostras suficientes para treinar.',
      inputSchema: { type: 'object', properties: { duplicataId: { type: 'string' } }, required: ['duplicataId'] },
      handler: async (input: { duplicataId: string }) => {
        const d = getDuplicata(input.duplicataId);
        if (!d) return { erro: 'duplicata não encontrada' };
        const model = getModel();
        if (!model) return { disponivel: false, motivo: `Modelo ainda não treinado (mínimo de ${MIN_TRAINING_SAMPLES} amostras rotuladas na base).` };
        const probabilidade = predictDefaultProbability(d);
        return { disponivel: true, probabilidadeResultadoRuim: probabilidade, amostrasDeTreino: model.nSamples, acuraciaDeTreino: model.trainAccuracy, treinadoEm: model.trainedAt };
      },
    },
  ],
};
