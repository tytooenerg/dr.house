import { Router } from 'express';
import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';
import { requireAuth } from '../auth/middleware.js';
import { CHAT_ANSWERS, CHAT_SUGGESTIONS } from '../data/seed.js';
import { asyncHandler } from '../lib/asyncHandler.js';

export const chatRouter = Router();
chatRouter.use(requireAuth);

const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;

const SYSTEM_PROMPT = `Você é o assistente da Lastro, uma plataforma brasileira de duplicatas escriturais que conecta empresas cedentes, empresas sacadas e investidores/financiadores (bancos, FIDCs, fundos), com registro em CERC/B3/Núclea, score de risco por IA e seguro sobre o recebível.
Responda em português do Brasil, em 2-4 frases, direto e específico ao produto Lastro. A Lastro não é um banco, não concede crédito e não assume risco de crédito — ela é infraestrutura tecnológica; operações de crédito são feitas por instituições financeiras parceiras. Se a pergunta não tiver relação com duplicatas, antecipação de recebíveis ou a plataforma Lastro, responda educadamente que seu foco é esse escopo.`;

chatRouter.get('/', (_req, res) => res.json({ suggestions: CHAT_SUGGESTIONS, llmEnabled: !!anthropic }));

const askSchema = z.object({ question: z.string().trim().min(1).max(2000) });

chatRouter.post(
  '/ask',
  asyncHandler(async (req, res) => {
    const parsed = askSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    const question = parsed.data.question;

    if (anthropic) {
      try {
        const message = await anthropic.messages.create({
          model: 'claude-sonnet-5',
          max_tokens: 300,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: question }],
        });
        const answer = message.content.find((b) => b.type === 'text')?.text ?? CHAT_ANSWERS[question] ?? 'Não consegui gerar uma resposta agora — tente novamente.';
        res.json({ question, answer, source: 'llm' });
        return;
      } catch (err) {
        console.error('[chat] Anthropic request failed, falling back to canned answers:', err);
      }
    }

    const answer = CHAT_ANSWERS[question] || 'Ainda não tenho uma resposta pronta para essa pergunta — mas nossa equipe de suporte pode ajudar em suporte@lastro.com.br.';
    res.json({ question, answer, source: 'canned' });
  })
);
