import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import { CHAT_ANSWERS, CHAT_SUGGESTIONS } from '../data/seed.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { aiFeatureLimiter } from '../lib/aiRateLimit.js';
import { askClaude, claudeEnabled } from '../lib/claude.js';

export const chatRouter = Router();
chatRouter.use(requireAuth);

const SYSTEM_PROMPT = `Você é o assistente da Lastro, uma plataforma brasileira de duplicatas escriturais que conecta empresas cedentes, empresas sacadas e investidores/financiadores (bancos, FIDCs, fundos), com registro em CERC/B3/Núclea, score de risco por IA e seguro sobre o recebível.
Responda em português do Brasil, em 2-4 frases, direto e específico ao produto Lastro. A Lastro não é um banco, não concede crédito e não assume risco de crédito — ela é infraestrutura tecnológica; operações de crédito são feitas por instituições financeiras parceiras. Se a pergunta não tiver relação com duplicatas, antecipação de recebíveis ou a plataforma Lastro, responda educadamente que seu foco é esse escopo.`;

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

    const answer = await askClaude(SYSTEM_PROMPT, question, 300, { feature: 'chat', userId: req.user!.id });
    if (answer) {
      res.json({ question, answer, source: 'llm' });
      return;
    }

    const canned = CHAT_ANSWERS[question] || 'Ainda não tenho uma resposta pronta para essa pergunta — mas nossa equipe de suporte pode ajudar em suporte@lastro.com.br.';
    res.json({ question, answer: canned, source: 'canned' });
  })
);
