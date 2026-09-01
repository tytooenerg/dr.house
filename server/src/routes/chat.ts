import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import { CHAT_ANSWERS, CHAT_SUGGESTIONS } from '../data/seed.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { aiFeatureLimiter } from '../lib/aiRateLimit.js';
import { askClaude, claudeEnabled } from '../lib/claude.js';
import { buildCashflowForecast } from '../lib/cashflowForecast.js';
import { getSettings } from '../db/users.js';
import type { UserRow } from '../db/types.js';

export const chatRouter = Router();
chatRouter.use(requireAuth);

const SYSTEM_PROMPT = `Você é o assistente da Lastro, uma plataforma brasileira de duplicatas escriturais que conecta empresas cedentes, empresas sacadas e investidores/financiadores (bancos, FIDCs, fundos), com registro em CERC/B3/Núclea, score de risco por IA e seguro sobre o recebível.
Responda em português do Brasil, em 2-4 frases, direto e específico ao produto Lastro. A Lastro não é um banco, não concede crédito e não assume risco de crédito — ela é infraestrutura tecnológica; operações de crédito são feitas por instituições financeiras parceiras. Se a pergunta não tiver relação com duplicatas, antecipação de recebíveis ou a plataforma Lastro, responda educadamente que seu foco é esse escopo.`;

// AI CFO grounding: when a cedente asks a cashflow-shaped question ("quanto vou receber",
// "quanto tenho disponível para antecipar", "qual meu caixa em 90 dias"), the assistant must
// answer from this real, computed-on-request forecast (lib/cashflowForecast.ts) — never a
// plausible-sounding guess. Only cedentes have payables/receivables to project; other roles
// get the base prompt unchanged.
async function systemPromptFor(user: UserRow): Promise<string> {
  if (user.role !== 'cedente') return SYSTEM_PROMPT;
  try {
    const forecast = await buildCashflowForecast(user.id, user.plan, getSettings(user).companyCnpj);
    const base = forecast.scenarios.find((s) => s.scenario === 'base')!;
    const linhas = base.points.map((p) => `  - em ${p.days} dias: saldo projetado ${p.saldoProjetadoFmt}${p.deficit ? ' (déficit)' : ''}`).join('\n');
    return `${SYSTEM_PROMPT}

Dados reais de fluxo de caixa deste cedente (cenário base, gerados agora — use-os para responder perguntas sobre caixa, recebíveis ou antecipação; nunca invente um número):
- Disponível para antecipação hoje: ${forecast.disponivelParaAntecipacaoFmt}
- Total de recebíveis pendentes (ainda não financiados): ${forecast.totalRecebiveisPendentesFmt}
- Total de contas a pagar pendentes: ${forecast.totalContasAPagarPendentesFmt}
- Projeção de saldo por horizonte:
${linhas}
${forecast.insights.map((i) => `- ${i.mensagem}`).join('\n')}`;
  } catch {
    // Never let a forecast computation error break the chat itself — fall back to the base prompt.
    return SYSTEM_PROMPT;
  }
}
// Note: this grounding runs for any cedente, regardless of plan — the Básico plan not
// having the paid AI CFO *page* (routes/cashflow.ts, gated at Pro) doesn't mean the chat
// assistant should answer cashflow questions with worse (invented) numbers instead of the
// same real computation.

chatRouter.get('/', (_req, res) => res.json({ suggestions: CHAT_SUGGESTIONS, llmEnabled: claudeEnabled }));

const askSchema = z.object({ question: z.string().trim().min(1).max(2000) });

chatRouter.post(
  '/ask',
  aiFeatureLimiter,
  asyncHandler(async (req, res) => {
    const parsed = askSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    const question = parsed.data.question;

    const systemPrompt = await systemPromptFor(req.user!);
    const answer = await askClaude(systemPrompt, question, 300, { feature: 'chat', userId: req.user!.id });
    if (answer) {
      res.json({ question, answer, source: 'llm' });
      return;
    }

    const canned = CHAT_ANSWERS[question] || 'Ainda não tenho uma resposta pronta para essa pergunta — mas nossa equipe de suporte pode ajudar em suporte@lastro.com.br.';
    res.json({ question, answer: canned, source: 'canned' });
  })
);
