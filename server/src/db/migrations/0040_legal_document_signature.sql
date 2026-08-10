-- Real e-signature tracking for reviewed legal_documents (lib/esignature.ts) — a reviewed
-- minuta previously just sat there as text with nowhere real to go for a signature.
ALTER TABLE legal_documents ADD COLUMN signature_status TEXT NOT NULL DEFAULT 'none' CHECK(signature_status IN ('none', 'enviado', 'assinado'));
ALTER TABLE legal_documents ADD COLUMN signature_envelope_id TEXT;
ALTER TABLE legal_documents ADD COLUMN signature_url TEXT;
ALTER TABLE legal_documents ADD COLUMN signer_name TEXT;
ALTER TABLE legal_documents ADD COLUMN signer_email TEXT;
ALTER TABLE legal_documents ADD COLUMN signature_sent_at TEXT;
ALTER TABLE legal_documents ADD COLUMN signature_signed_at TEXT;
