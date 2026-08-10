import { logger } from './logger.js';

// Real-when-configured e-signature adapter for legal_documents (lib/legalDraftGenerator.ts,
// lib/legalCollection.ts) once an admin has reviewed a draft — closes the gap between
// "Claude drafted a real document, a human reviewed it" and "it's actually signed", which
// this codebase never did before: a reviewed minuta just sat there as text with nowhere to
// go for a real signature.
//
// Deliberately generic instead of hardcoded to one vendor's exact endpoint shape (same
// reasoning as lib/biometricKyc.ts's provider-agnostic adapter): e-signature providers
// (Clicksign, DocuSign, D4Sign, Adobe Sign) each have their own real API contract, and
// getting one specific vendor's exact request/response shape wrong would mean this adapter
// silently fails against whichever real provider someone actually configures. ESIGNATURE_API_URL
// is expected to point at a REST endpoint accepting {documentKey, contentBase64, signerName,
// signerEmail} → {envelopeId, signUrl} for creation and returning {status: 'enviado'|'assinado'}
// for a status check — adjust the two functions below to your actual provider's real contract
// before pointing this at production; the shape here is a reasonable default, not verified
// against any one vendor's current API reference.
const apiUrl = process.env.ESIGNATURE_API_URL;
const apiKey = process.env.ESIGNATURE_API_KEY;
export const esignatureEnabled = !!(apiUrl && apiKey);

if (esignatureEnabled) logger.info('[esignature] provedor de assinatura eletrônica configurado — envio real habilitado');
else logger.info('[esignature] ESIGNATURE_API_URL/KEY não configurado — envio para assinatura eletrônica será simulado');

export interface SendForSignatureResult {
  envelopeId: string;
  signUrl: string | null;
  simulado: boolean;
}

export async function sendForSignature(opts: { documentKey: string; content: string; signerName: string; signerEmail: string }): Promise<SendForSignatureResult> {
  if (!esignatureEnabled) {
    // Same simulated-but-labeled pattern as every other unconfigured rail in this codebase
    // (pix.ts, boleto.ts, ted.ts) — a real-looking envelope id, never presented as a real send.
    return { envelopeId: `SIM-${Date.now().toString(36).toUpperCase()}`, signUrl: null, simulado: true };
  }
  const res = await fetch(`${apiUrl!.replace(/\/$/, '')}/envelopes`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      documentKey: opts.documentKey,
      contentBase64: Buffer.from(opts.content, 'utf8').toString('base64'),
      signerName: opts.signerName,
      signerEmail: opts.signerEmail,
    }),
  });
  if (!res.ok) throw new Error(`esignature_send_failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { envelopeId?: string; signUrl?: string };
  if (!data.envelopeId) throw new Error('esignature_send_no_envelope_id');
  return { envelopeId: data.envelopeId, signUrl: data.signUrl ?? null, simulado: false };
}

export async function checkSignatureStatus(envelopeId: string): Promise<'enviado' | 'assinado'> {
  if (!esignatureEnabled) {
    // No real callback URL reachable from this sandbox to drive a real status transition —
    // simulated mode resolves to "assinado" the first time anyone actually checks, so the
    // demo flow has an end state rather than hanging in "enviado" forever. Never claims this
    // is a real signature; the UI's own label makes clear the provider isn't configured.
    return 'assinado';
  }
  const res = await fetch(`${apiUrl!.replace(/\/$/, '')}/envelopes/${envelopeId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`esignature_status_failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { status?: string };
  return data.status === 'assinado' ? 'assinado' : 'enviado';
}
