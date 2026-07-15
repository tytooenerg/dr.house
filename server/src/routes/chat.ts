import { Router } from 'express';
import { CHAT_ANSWERS, CHAT_SUGGESTIONS } from '../data/seed.js';

export const chatRouter = Router();

chatRouter.get('/', (_req, res) => res.json({ suggestions: CHAT_SUGGESTIONS }));

chatRouter.post('/ask', (req, res) => {
  const question: string = req.body.question || '';
  const answer =
    CHAT_ANSWERS[question] ||
    'Ainda não tenho uma resposta pronta para essa pergunta — mas nossa equipe de suporte pode ajudar em suporte@lastro.com.br.';
  res.json({ question, answer });
});
