import { hasUploadOfKind } from '../db/misc.js';

// KYB documental do CEDENTE — até aqui só o investidor passava por credenciamento
// documental (ver KybModal.tsx/routes/auth.ts's POST /kyb); quem recebe o dinheiro
// antecipado nunca teve que provar que a empresa por trás da duplicata existe de verdade.
// Reaproveita a MESMA máquina de estado do investidor (users.kyb_status: none → pending →
// approved/rejected, db/users.ts's submitKybForReview/approveKyb/rejectKyb, fila em
// GET/POST /admin/kyb) — só o que conta como "documentos completos" é diferente: três
// uploads distintos (kind próprio cada um, mesma rota genérica POST /uploads) em vez do
// único kyb_doc genérico do investidor.
export const CEDENTE_KYB_KINDS = ['kyb_cedente_cnpj', 'kyb_cedente_contrato_social', 'kyb_cedente_representante'] as const;

export function cedenteKybDocsComplete(userId: number): boolean {
  return CEDENTE_KYB_KINDS.every((kind) => hasUploadOfKind(userId, kind));
}
