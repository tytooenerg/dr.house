import { getUserById } from '../../db/users.js';
import { getPurchaseById } from '../../db/resaleListings.js';
import { getDuplicata } from '../../db/duplicatas.js';
import { buildResumoFiscalCedente } from '../fiscalCedente.js';
import { buildIncomeTaxStatement, aliquotaForDias, IR_REGRESSIVE_TABLE } from '../incomeTaxStatement.js';
import { fmtBRL, parseFlexibleDate } from '../format.js';
import type { AgentDefinition } from '../agentRuntime.js';

// O Agente Fiscal lê e explica — não apura, não retém e não recolhe.
//
// Isso não é timidez: a Lastro não retém IR hoje (settlePurchase credita o retorno cheio, ver
// lib/incomeTaxStatement.ts), e o IOF do cedente é estimativa sobre alíquotas que mudam por
// decreto. Um agente com tool de "emitir guia" daria a impressão contrária — por isso nenhuma
// tool aqui é `sensitive`: não há nada aqui que mova dinheiro ou constitua obrigação.
export const fiscalAgent: AgentDefinition = {
  id: 'fiscal',
  label: 'Agente Fiscal',
  description:
    'Explica o efeito tributário das operações da conta: o deságio como despesa financeira e o IOF do cedente, e a tabela regressiva do IR do investidor.',
  selfServiceRoles: ['cedente', 'investidor'],
  systemPrompt: `Você é o assistente fiscal da Lastro. Responda SOMENTE com base no que as tools devolverem — nunca invente alíquota, prazo, código de receita ou dispositivo legal que não tenha vindo delas. Para um cedente, use resumo_fiscal_cedente: o deságio pago é despesa financeira e o IOF depende do veículo de quem comprou (factoring e instituição financeira sofrem IOF; FIDC e fundo não). Para um investidor, use informe_do_investidor e explicar_aliquota_ir (tabela regressiva da Lei 11.033/2004). Sempre diga que os números são insumo para a contabilidade e não uma apuração: a Lastro não apura, não retém e não recolhe tributo. Quando o veículo do comprador não for conhecido, diga que a incidência é indeterminada — nunca afirme que não houve IOF.`,
  tools: [
    {
      name: 'resumo_fiscal_cedente',
      description: 'Resumo fiscal das duplicatas do cedente negociadas num ano: valor de face, preço recebido, deságio como despesa financeira, taxa de plataforma e IOF por operação.',
      inputSchema: { type: 'object', properties: { userId: { type: 'number' }, ano: { type: 'number' } }, required: ['userId'] },
      handler: async (input: { userId: number; ano?: number }) => {
        const u = getUserById(input.userId);
        if (!u || u.role !== 'cedente') return { erro: 'esta conta não é de cedente' };
        const r = buildResumoFiscalCedente(u.id, input.ano ?? new Date().getFullYear());
        return {
          ano: r.ano,
          operacoes: r.operacoes,
          valorFaceTotal: r.valorFaceTotalFmt,
          precoRecebidoTotal: r.precoRecebidoTotalFmt,
          despesaFinanceiraTotal: r.despesaFinanceiraTotalFmt,
          taxaPlataformaTotal: r.taxaPlataformaTotalFmt,
          iofTotal: r.iofTotalFmt,
          operacoesComIofIndeterminado: r.iofIndeterminadas,
          aliquotasUsadas: r.aliquotas,
          aviso: r.aviso,
          avisoRegimeTributario: r.avisoRegimeTributario,
          linhas: r.linhas.map((l) => ({
            duplicataId: l.duplicataId,
            sacado: l.sacado,
            data: l.dataNegociacao,
            precoRecebido: l.precoRecebidoFmt,
            despesaFinanceira: l.despesaFinanceiraFmt,
            veiculoComprador: l.veiculoComprador,
            iof: l.iofValorFmt,
            iofMotivo: l.iofMotivo,
          })),
        };
      },
    },
    {
      name: 'informe_do_investidor',
      description: 'Informe de rendimentos do investidor num ano — as posições resgatadas e o IR estimado pela tabela regressiva.',
      inputSchema: { type: 'object', properties: { userId: { type: 'number' }, ano: { type: 'number' } }, required: ['userId'] },
      handler: async (input: { userId: number; ano?: number }) => {
        const u = getUserById(input.userId);
        if (!u) return { erro: 'conta não encontrada' };
        return buildIncomeTaxStatement(u.id, u.company_name, input.ano ?? new Date().getFullYear());
      },
    },
    {
      name: 'explicar_aliquota_ir',
      description: 'A faixa da tabela regressiva do IR (Lei 11.033/2004) que se aplica a um prazo em dias, e a tabela inteira para contexto.',
      inputSchema: { type: 'object', properties: { dias: { type: 'number' } }, required: ['dias'] },
      handler: async (input: { dias: number }) => ({
        dias: input.dias,
        faixaAplicavel: aliquotaForDias(input.dias).label,
        aliquota: aliquotaForDias(input.dias).aliquota,
        tabela: IR_REGRESSIVE_TABLE.map((b) => b.label),
        fonte: 'Lei 11.033/2004 — tabela regressiva de IR de renda fixa',
      }),
    },
    {
      name: 'simular_ir_da_posicao',
      description: 'O IR que incidiria sobre uma posição do investidor se ela fosse levada até o vencimento da duplicata.',
      inputSchema: { type: 'object', properties: { purchaseId: { type: 'number' } }, required: ['purchaseId'] },
      handler: async (input: { purchaseId: number }) => {
        const p = getPurchaseById(input.purchaseId);
        if (!p) return { erro: 'posição não encontrada' };
        const d = getDuplicata(p.duplicata_id);
        if (!d) return { erro: 'duplicata da posição não encontrada' };
        const dias = Math.max(
          0,
          Math.round((parseFlexibleDate(d.vencimento).getTime() - new Date(p.created_at + 'Z').getTime()) / 86_400_000)
        );
        const faixa = aliquotaForDias(dias);
        const ir = p.retorno * faixa.aliquota;
        return {
          duplicataId: p.duplicata_id,
          prazoDias: dias,
          faixa: faixa.label,
          rendimento: fmtBRL(p.retorno),
          irEstimado: fmtBRL(ir),
          liquidoEstimado: fmtBRL(p.retorno - ir),
          aviso: 'Estimativa: a Lastro não retém IR hoje — o recolhimento é responsabilidade do investidor.',
        };
      },
    },
  ],
};
