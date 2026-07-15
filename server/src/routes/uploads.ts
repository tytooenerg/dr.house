import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireAuth } from '../auth/middleware.js';
import { addUpload } from '../db/misc.js';
import { markKybDone } from '../db/users.js';

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

uploadsRouter.post('/', (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      res.status(400).json({ error: 'upload_error', message: err.message });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: 'no_file', message: 'Nenhum arquivo enviado.' });
      return;
    }
    const kind = typeof req.body.kind === 'string' ? req.body.kind : 'outro';
    const record = addUpload(req.user!.id, kind, req.file.originalname, req.file.filename);

    if (kind === 'kyb_doc') markKybDone(req.user!.id);

    // Simulate NF-e data extraction for the "anexar NF-e" flow — a real integration
    // would parse the XML/PDF; here we surface plausible extracted fields.
    const extracted =
      kind === 'nfe'
        ? { sacado: 'Grupo Atlas Varejo', cnpj: '12.345.678/0001-90', valor: '84.500,00', vencimento: '2026-08-12' }
        : null;

    res.status(201).json({ upload: { id: record.id, filename: record.filename, kind: record.kind, createdAt: record.created_at }, extracted });
  });
});
