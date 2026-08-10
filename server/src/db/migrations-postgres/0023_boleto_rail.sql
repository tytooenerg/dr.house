-- Real boleto payment rail (lib/boletoRail.ts) — an alternative deposit method alongside
-- Pix on Conta & Liquidação. Same shape as pix_charges: real when a PSP/banking partner
-- is configured (BOLETO_PSP_*), simulated (manual "Confirmar (simulado)") otherwise.
CREATE TABLE IF NOT EXISTS boletos (
  nosso_numero TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  valor REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'ativo' CHECK(status IN ('ativo', 'pago', 'expirado')),
  simulado INTEGER NOT NULL DEFAULT 1,
  linha_digitavel TEXT,
  codigo_barras TEXT,
  pdf_url TEXT,
  created_at TEXT NOT NULL DEFAULT now(),
  paid_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_boletos_user ON boletos(user_id);
