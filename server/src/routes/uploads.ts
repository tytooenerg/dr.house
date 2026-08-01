import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireAuth } from '../auth/middleware.js';
import { addUpload } from '../db/misc.js';
import { markKybDone } from '../db/users.js';
import { extractNfeFields } from '../lib/nfeExtraction.js';
import { analyzeContract } from '../lib/contractAnalysis.js';
import { recordContractAnalysis } from '../db/contractAnalyses.js';
import { asyncHandler } from '../lib/asyncHandler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadDir = path.resolve(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${req.user!.id}-${Date.now()}-${safe}`);
  },
});

const ALLOWED_MIME = new Set(['application/pdf', 'application/xml', 'text/xml', 'image/png', 'image/jpeg']);

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      cb(new Error('Tipo de arquivo não suportado. Envie PDF, XML, PNG ou JPG.'));
      return;
    }
    cb(null, true);
  },
});

export const uploadsRouter = Router();
uploadsRouter.use(requireAuth);

uploadsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    await new Promise<void>((resolve, reject) => {
      upload.single('file')(req, res, (err) => (err ? reject(err) : resolve()));
    }).catch((err: Error) => {
      res.status(400).json({ error: 'upload_error', message: err.message });
    });
    if (res.headersSent) return;
    if (!req.file) {
      res.status(400).json({ error: 'no_file', message: 'Nenhum arquivo enviado.' });
      return;
    }
    const kind = typeof req.body.kind === 'string' ? req.body.kind : 'outro';
    const record = addUpload(req.user!.id, kind, req.file.originalname, req.file.filename);

    if (kind === 'kyb_doc') markKybDone(req.user!.id);

    // Real NF-e data extraction via Claude (lib/nfeExtraction.ts) — reads the actual
    // uploaded file instead of always returning the same hardcoded sample. Returns null
    // (not a fabricated guess) when ANTHROPIC_API_KEY isn't set or extraction fails, so
    // the cedente just fills the form manually as before.
    const extracted = kind === 'nfe' ? await extractNfeFields(req.file.path, req.file.mimetype) : null;

    // Real contract clause analysis (lib/contractAnalysis.ts) — replaces the static
    // CONTRACT_FLAGS demo copy on Compliance's "Leitura de contratos" card. Persisted so
    // the Compliance screen can show it again on reload, not just in this response.
    let analysis = null;
    if (kind === 'contrato_cessao') {
      analysis = await analyzeContract(req.file.path, req.file.mimetype);
      if (analysis) recordContractAnalysis(req.user!.id, record.id, req.file.originalname, analysis);
    }

    res.status(201).json({ upload: { id: record.id, filename: record.filename, kind: record.kind, createdAt: record.created_at }, extracted, analysis });
  })
);
