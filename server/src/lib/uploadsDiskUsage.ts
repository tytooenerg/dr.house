import fs from 'node:fs';
import path from 'node:path';
import { db } from '../db/index.js';
import { uploadDir } from '../routes/uploads.js';

// Achado numa revisão de produção: nenhum upload (comprovantes, contratos, documentos de
// KYB) jamais é apagado — fs.unlink/rmSync nunca é chamado sobre uploadDir em lugar
// nenhum do código. Isso provavelmente está certo (documentos de KYC/compliance em geral
// PRECISAM ser retidos por anos, não apagados) — mas sem nenhuma visibilidade, um disco
// cheio seria descoberto só quando algo já tivesse quebrado. Isto não apaga nada; só
// soma, pra aparecer no back-office antes que vire um problema.
export interface UploadsDiskUsage {
  totalBytes: number;
  fileCount: number;
  // Registrado no banco, mas o arquivo não existe mais em disco (ex: diretório recriado
  // manualmente) — não é um erro deste código, só um fato que vale mostrar.
  missingCount: number;
  byKind: { kind: string; count: number; bytes: number }[];
}

export function computeUploadsDiskUsage(): UploadsDiskUsage {
  const rows = db.prepare('SELECT kind, path FROM uploads').all() as { kind: string; path: string }[];
  const byKindMap = new Map<string, { count: number; bytes: number }>();
  let totalBytes = 0;
  let fileCount = 0;
  let missingCount = 0;

  for (const row of rows) {
    let size: number;
    try {
      size = fs.statSync(path.join(uploadDir, row.path)).size;
    } catch {
      missingCount++;
      continue;
    }
    totalBytes += size;
    fileCount++;
    const entry = byKindMap.get(row.kind) ?? { count: 0, bytes: 0 };
    entry.count++;
    entry.bytes += size;
    byKindMap.set(row.kind, entry);
  }

  const byKind = [...byKindMap.entries()].map(([kind, v]) => ({ kind, ...v })).sort((a, b) => b.bytes - a.bytes);
  return { totalBytes, fileCount, missingCount, byKind };
}
