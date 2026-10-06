import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireAuth } from '../auth/middleware.js';
import { addUpload } from '../db/misc.js';
import { getDuplicata } from '../db/duplicatas.js';
import { markKybDone, updateSettings, effectiveOwnerId } from '../db/users.js';
import { extractNfeFields } from '../lib/nfeExtraction.js';
import { extractNfseFields } from '../lib/nfseExtraction.js';
import { analyzeContract } from '../lib/contractAnalysis.js';
import { recordContractAnalysis } from '../db/contractAnalyses.js';
import { verificarProvaDeVida } from '../lib/biometricKyc.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { aiFeatureLimiter } from '../lib/aiRateLimit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Exportado pra lib/uploadsDiskUsage.ts reusar o mesmo caminho em vez de duplicá-lo.
export const uploadDir = path.resolve(__dirname, '../../uploads');
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
  aiFeatureLimiter,
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

    // Vincula o upload a uma duplicata específica quando informado — essencial pro
    // instrumento de cessão (kind='contrato_cessao'), que sem isso ficava só preso à conta
    // de quem enviou, sem registro de qual operação ele realmente comprova. Checa posse
    // (effectiveOwnerId, mesma regra de lib/auctionOpen.ts) pra uma conta nunca conseguir
    // anexar documento à duplicata de outra.
    let duplicataId: string | null = null;
    if (typeof req.body.duplicataId === 'string' && req.body.duplicataId.trim()) {
      const d = getDuplicata(req.body.duplicataId.trim());
      if (!d || d.cedente_id !== effectiveOwnerId(req.user!)) {
        res.status(404).json({ error: 'duplicata_not_found', message: 'Duplicata não encontrada ou não pertence a esta conta.' });
        return;
      }
      duplicataId = d.id;
    }

    const record = addUpload(req.user!.id, kind, req.file.originalname, req.file.filename, duplicataId);

    if (kind === 'kyb_doc') markKybDone(req.user!.id);

    // Real NF-e/NFS-e data extraction via Claude (lib/nfeExtraction.ts,
    // lib/nfseExtraction.ts) — reads the actual uploaded file instead of always returning
    // the same hardcoded sample. Returns null (not a fabricated guess) when
    // ANTHROPIC_API_KEY isn't set or extraction fails, so the cedente just fills the form
    // manually as before. Separate extractors, não um if/else no mesmo prompt — NFS-e não
    // segue o layout nacional da NF-e (ver lib/nfseExtraction.ts).
    const extracted =
      kind === 'nfe'
        ? await extractNfeFields(req.file.path, req.file.mimetype, req.user!.id)
        : kind === 'nfse'
          ? await extractNfseFields(req.file.path, req.file.mimetype, req.user!.id)
          : null;

    // Real contract clause analysis (lib/contractAnalysis.ts) — replaces the static
    // CONTRACT_FLAGS demo copy on Compliance's "Leitura de contratos" card. Persisted so
    // the Compliance screen can show it again on reload, not just in this response.
    let analysis = null;
    if (kind === 'contrato_cessao') {
      analysis = await analyzeContract(req.file.path, req.file.mimetype, req.user!.id);
      if (analysis) recordContractAnalysis(req.user!.id, record.id, req.file.originalname, analysis);
    }

    // Real biometric liveness check (lib/biometricKyc.ts) — replaces the old "Em análise"
    // placeholder Conta & Liquidação's KYC checklist always showed for this step. Returns
    // null (not a fabricated pass) when BIOMETRIC_KYC_API_URL/KEY isn't set, so the step
    // stays "Pendente" honestly instead of claiming a check that never happened.
    let biometria: { passed: boolean; confidence: number } | null = null;
    if (kind === 'selfie_liveness') {
      const buffer = fs.readFileSync(req.file.path);
      const result = await verificarProvaDeVida(buffer, req.file.mimetype);
      if (result) {
        updateSettings(req.user!.id, { biometricVerified: result.passed });
        biometria = { passed: result.passed, confidence: result.confidence };
      }
    }

    res.status(201).json({
      upload: { id: record.id, filename: record.filename, kind: record.kind, duplicataId: record.duplicata_id, createdAt: record.created_at },
      extracted,
      analysis,
      biometria,
    });
  })
);
