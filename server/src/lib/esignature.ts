import { logger } from './logger.js';

// Real-when-configured e-signature adapter for legal_documents (lib/legalDraftGenerator.ts,
// lib/legalCollection.ts) once an admin has reviewed a draft — closes the gap between
// "Claude drafted a real document, a human reviewed it" and "it's actually signed", which
// this codebase never did before: a reviewed minuta just sat there as text with nowhere to
// go for a real signature.
//
// Targets Clicksign's REST API v1 (ESIGNATURE_API_URL = https://sandbox.clicksign.com or
// https://app.clicksign.com, ESIGNATURE_API_KEY = the account's access_token). Clicksign's
// v1 flow needs three calls to get a document signed — create the document, create the
// signer, then link them via a "list" — unlike the single-POST shape this adapter had
// before anyone picked a real vendor. Clicksign notifies the signer directly by e-mail/SMS
// rather than handing back an embeddable URL for the default flow, so signUrl stays null on
// the real path too. Written from Clicksign's documented v1 contract, not verified against a
// live sandbox call (this environment can't reach the internet) — run a real test send
// before trusting this against production traffic, and adjust field names here if the
// sandbox returns something different.
const apiUrl = process.env.ESIGNATURE_API_URL;
const apiKey = process.env.ESIGNATURE_API_KEY;
export const esignatureEnabled = !!(apiUrl && apiKey);

if (esignatureEnabled) logger.info('[esignature] Clicksign configurado (ESIGNATURE_API_URL/KEY) — envio real habilitado');
else logger.info('[esignature] ESIGNATURE_API_URL/KEY não configurado — envio para assinatura eletrônica será simulado');

export interface SendForSignatureResult {
  envelopeId: string;
  signUrl: string | null;
  simulado: boolean;
}

async function clicksignRequest<T>(path: string, body: unknown): Promise<T> {
  const url = `${apiUrl!.replace(/\/$/, '')}${path}?access_token=${encodeURIComponent(apiKey!)}`;
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`esignature_send_failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

export async function sendForSignature(opts: { documentKey: string; content: string; signerName: string; signerEmail: string }): Promise<SendForSignatureResult> {
  if (!esignatureEnabled) {
    // Same simulated-but-labeled pattern as every other unconfigured rail in this codebase
    // (pix.ts, boleto.ts, ted.ts) — a real-looking envelope id, never presented as a real send.
    return { envelopeId: `SIM-${Date.now().toString(36).toUpperCase()}`, signUrl: null, simulado: true };
  }

  const contentBase64 = Buffer.from(opts.content, 'utf8').toString('base64');
  const docRes = await clicksignRequest<{ document?: { key?: string } }>('/api/v1/documents', {
    document: { path: `/${opts.documentKey}.pdf`, content_base64: `data:application/pdf;base64,${contentBase64}`, auto_close: true, locale: 'pt-BR' },
  });
  const documentKey = docRes.document?.key;
  if (!documentKey) throw new Error('esignature_send_no_document_key');

  const signerRes = await clicksignRequest<{ signer?: { key?: string } }>('/api/v1/signers', {
    signer: { email: opts.signerEmail, name: opts.signerName, auths: ['email'] },
  });
  const signerKey = signerRes.signer?.key;
  if (!signerKey) throw new Error('esignature_send_no_signer_key');

  await clicksignRequest('/api/v1/lists', { list: { document_key: documentKey, signer_key: signerKey, sign_as: 'sign' } });

  return { envelopeId: documentKey, signUrl: null, simulado: false };
}

export async function checkSignatureStatus(envelopeId: string): Promise<'enviado' | 'assinado'> {
  if (!esignatureEnabled) {
    // No real callback URL reachable from this sandbox to drive a real status transition —
    // simulated mode resolves to "assinado" the first time anyone actually checks, so the
    // demo flow has an end state rather than hanging in "enviado" forever. Never claims this
    // is a real signature; the UI's own label makes clear the provider isn't configured.
    return 'assinado';
  }
  const url = `${apiUrl!.replace(/\/$/, '')}/api/v1/documents/${envelopeId}?access_token=${encodeURIComponent(apiKey!)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`esignature_status_failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { document?: { status?: string } };
  return data.document?.status === 'closed' ? 'assinado' : 'enviado';
}
