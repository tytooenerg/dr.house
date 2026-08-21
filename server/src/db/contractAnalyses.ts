import { db } from './index.js';

export interface ContractFlag {
  text: string;
  severity: 'ok' | 'atencao' | 'critico';
}

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
