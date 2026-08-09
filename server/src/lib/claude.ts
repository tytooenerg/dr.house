import Anthropic from '@anthropic-ai/sdk';
import { logger } from './logger.js';
import { recordClaudeUsage } from '../db/claudeUsage.js';

// Single shared Anthropic client for every AI-assisted feature in the app (chat, NF-e
// extraction, contract analysis, risk narrative, dispute/sinistro copilots, PLD second
// opinion, Compliance AI Engine reasoning) — same honest pattern as every other adapter
// here: real when configured, clearly-logged fallback when not, gated by the same
// ANTHROPIC_API_KEY chat.ts already used.
const apiKey = process.env.ANTHROPIC_API_KEY;
export const claudeEnabled = !!apiKey;
const client = apiKey ? new Anthropic({ apiKey }) : null;
const MODEL = 'claude-sonnet-5';

if (claudeEnabled) logger.info('[claude] ANTHROPIC_API_KEY configurado — recursos assistidos por IA reais habilitados');
else logger.info('[claude] ANTHROPIC_API_KEY não configurado — recursos assistidos por IA usarão fallback estático');

// Every call site identifies which feature it is (so admin/ai-usage can break down spend)
// and, where cheaply available, which user triggered it — see db/claudeUsage.ts.
export interface ClaudeCallMeta {
  feature: string;
  userId?: number;
}

function logUsage(meta: ClaudeCallMeta, usage: Anthropic.Usage | undefined, ok: boolean) {
  try {
    recordClaudeUsage({
      feature: meta.feature,
      userId: meta.userId ?? null,
      inputTokens: usage?.input_tokens ?? 0,
      outputTokens: usage?.output_tokens ?? 0,
      ok,
    });
  } catch (err) {
    // Metering must never break the actual feature — just log and move on.
    logger.warn({ err }, '[claude] falha ao registrar uso/custo');
  }
}

export async function askClaude(system: string, userMessage: string, maxTokens: number, meta: ClaudeCallMeta): Promise<string | null> {
  if (!client) return null;
  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: userMessage }],
    });
    logUsage(meta, message.usage, true);
    return message.content.find((b) => b.type === 'text')?.text ?? null;
  } catch (err) {
    logger.warn({ err }, '[claude] chamada de texto falhou');
    logUsage(meta, undefined, false);
    return null;
  }
}

export type DocumentInput = { buffer: Buffer; mimeType: string };

// Vision/document call — images go in as `image` blocks, PDFs as `document` blocks
// (both real Claude Messages API content types), plain text/XML is just inlined as text
// since Claude reads structured markup directly without needing a vision pass.
export async function askClaudeWithDocument(
  system: string,
  instruction: string,
  doc: DocumentInput,
  maxTokens: number,
  meta: ClaudeCallMeta
): Promise<string | null> {
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
    logUsage(meta, message.usage, true);
    return message.content.find((b) => b.type === 'text')?.text ?? null;
  } catch (err) {
    logger.warn({ err }, '[claude] chamada com documento falhou');
    logUsage(meta, undefined, false);
    return null;
  }
}

// Tool-use call for the agentic layer (lib/agentRuntime.ts) — every other function in this
// file is a single request/response turn; this one hands Claude a real tool belt and
// returns the raw Message so the caller can inspect stop_reason / tool_use blocks and
// drive the loop (execute tools, feed results back, repeat). Same real-when-configured
// gate as every other call here: null when ANTHROPIC_API_KEY isn't set.
export async function askClaudeWithTools(params: {
  system: string;
  messages: Anthropic.MessageParam[];
  tools: Anthropic.Tool[];
  maxTokens: number;
  meta: ClaudeCallMeta;
}): Promise<Anthropic.Message | null> {
  if (!client) return null;
  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: params.maxTokens,
      system: params.system,
      messages: params.messages,
      tools: params.tools,
    });
    logUsage(params.meta, message.usage, true);
    return message;
  } catch (err) {
    logger.warn({ err }, '[claude] chamada de agente (tool use) falhou');
    logUsage(params.meta, undefined, false);
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
