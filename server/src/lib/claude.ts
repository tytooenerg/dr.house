import Anthropic from '@anthropic-ai/sdk';
import { logger } from './logger.js';

// Single shared Anthropic client for every AI-assisted feature in the app (chat, NF-e
// extraction, contract analysis, risk narrative, dispute/sinistro copilots, PLD second
// opinion) — same honest pattern as every other adapter here: real when configured,
// clearly-logged fallback when not, gated by the same ANTHROPIC_API_KEY chat.ts already
// used.
const apiKey = process.env.ANTHROPIC_API_KEY;
export const claudeEnabled = !!apiKey;
const client = apiKey ? new Anthropic({ apiKey }) : null;
const MODEL = 'claude-sonnet-5';

if (claudeEnabled) logger.info('[claude] ANTHROPIC_API_KEY configurado — recursos assistidos por IA reais habilitados');
else logger.info('[claude] ANTHROPIC_API_KEY não configurado — recursos assistidos por IA usarão fallback estático');

export async function askClaude(system: string, userMessage: string, maxTokens = 500): Promise<string | null> {
  if (!client) return null;
  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: userMessage }],
    });
    return message.content.find((b) => b.type === 'text')?.text ?? null;
  } catch (err) {
    logger.warn({ err }, '[claude] chamada de texto falhou');
    return null;
  }
}

export type DocumentInput = { buffer: Buffer; mimeType: string };

// Vision/document call — images go in as `image` blocks, PDFs as `document` blocks
// (both real Claude Messages API content types), plain text/XML is just inlined as text
// since Claude reads structured markup directly without needing a vision pass.
export async function askClaudeWithDocument(system: string, instruction: string, doc: DocumentInput, maxTokens = 500): Promise<string | null> {
  if (!client) return null;
  try {
    const content: Anthropic.MessageParam['content'] =
      doc.mimeType === 'application/pdf'
        ? [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: doc.buffer.toString('base64') } },
            { type: 'text', text: instruction },
          ]
        : doc.mimeType === 'image/png' || doc.mimeType === 'image/jpeg'
          ? [
              { type: 'image', source: { type: 'base64', media_type: doc.mimeType, data: doc.buffer.toString('base64') } },
              { type: 'text', text: instruction },
            ]
          : [{ type: 'text', text: `${instruction}\n\n---\n${doc.buffer.toString('utf-8').slice(0, 20_000)}` }];

    const message = await client.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content }],
    });
    return message.content.find((b) => b.type === 'text')?.text ?? null;
  } catch (err) {
    logger.warn({ err }, '[claude] chamada com documento falhou');
    return null;
  }
}

// Tolerant JSON extraction — Claude sometimes wraps JSON in prose/fences despite
// instructions; this pulls the first {...} block rather than failing the whole feature.
export function extractJson<T>(text: string): T | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as T;
  } catch {
    return null;
  }
}
