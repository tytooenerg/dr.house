import { db } from './index.js';
import { COLORS } from '../data/seed.js';

export interface ContractFlag {
  text: string;
  severity: 'ok' | 'atencao' | 'critico';
}

// Compartilhado por routes/compliance.ts (leitura de contrato genérica) e routes/minhas.ts
// (instrumento de cessão vinculado a uma duplicata) — mesmo significado de negócio
// (severidade → cor), um lugar só pra não divergir entre as duas telas.
export const SEVERITY_COLOR: Record<ContractFlag['severity'], string> = { ok: COLORS.GREEN, atencao: COLORS.AMBER, critico: COLORS.RED };

export interface ContractAnalysisRow {
  id: number;
  user_id: number;
  upload_id: number | null;
  filename: string;
  flags_json: string;
  created_at: string;
}

export function recordContractAnalysis(userId: number, uploadId: number | null, filename: string, flags: ContractFlag[]) {
  db.prepare('INSERT INTO contract_analyses (user_id, upload_id, filename, flags_json) VALUES (?, ?, ?, ?)').run(
    userId,
    uploadId,
    filename,
    JSON.stringify(flags)
  );
}

export function getLatestContractAnalysis(userId: number): { filename: string; flags: ContractFlag[]; createdAt: string } | null {
  const row = db.prepare('SELECT * FROM contract_analyses WHERE user_id = ? ORDER BY created_at DESC LIMIT 1').get(userId) as
    | ContractAnalysisRow
    | undefined;
  if (!row) return null;
  return { filename: row.filename, flags: JSON.parse(row.flags_json), createdAt: row.created_at };
}

// A análise de UM upload específico — diferente de getLatestContractAnalysis (mais recente
// da conta, usado pela Compliance genérica), este busca a análise do contrato de cessão
// efetivamente vinculado a uma duplicata (routes/minhas.ts via db/misc.ts's
// getUploadForDuplicata).
export function getContractAnalysisByUploadId(uploadId: number): { filename: string; flags: ContractFlag[]; createdAt: string } | null {
  const row = db.prepare('SELECT * FROM contract_analyses WHERE upload_id = ? ORDER BY created_at DESC LIMIT 1').get(uploadId) as
    | ContractAnalysisRow
    | undefined;
  if (!row) return null;
  return { filename: row.filename, flags: JSON.parse(row.flags_json), createdAt: row.created_at };
}
