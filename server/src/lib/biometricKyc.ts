import { logger } from './logger.js';

// Real-when-configured adapter for a commercial biometric KYC/liveness provider (idwall,
// Unico, ClearSale-style) — proves a selfie was captured from a live person (not a photo
// of a photo, a mask, or a screen replay), the antifraude step most KYB flows in this
// space now expect beyond a plain document upload. Requires a real commercial contract
// this environment can't provide, same honest pattern as lib/creditBureau.ts. No-op until
// BIOMETRIC_KYC_API_URL/KEY are set.
const apiUrl = process.env.BIOMETRIC_KYC_API_URL;
const apiKey = process.env.BIOMETRIC_KYC_API_KEY;
export const biometricKycEnabled = !!(apiUrl && apiKey);

if (biometricKycEnabled) logger.info('[biometric-kyc] provedor de biometria configurado — verificação de prova de vida real habilitada');
else logger.info('[biometric-kyc] BIOMETRIC_KYC_API_URL/KEY não configurado — verificação biométrica desativada');

export interface LivenessResult {
  passed: boolean;
  confidence: number; // 0-100
  fonte: string;
}

export async function verificarProvaDeVida(selfieBuffer: Buffer, mimeType: string): Promise<LivenessResult | null> {
  if (!biometricKycEnabled) return null;
  const res = await fetch(`${apiUrl}/liveness`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: selfieBuffer.toString('base64'), mimeType }),
  });
  if (!res.ok) throw new Error(`biometric_kyc_failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { passed?: boolean; confidence?: number };
  return { passed: !!data.passed, confidence: Math.max(0, Math.min(100, data.confidence ?? 0)), fonte: 'provedor_biometrico' };
}
