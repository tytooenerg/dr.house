ALTER TABLE reconciliation_flags DROP CONSTRAINT reconciliation_flags_tipo_check;
ALTER TABLE reconciliation_flags ADD CONSTRAINT reconciliation_flags_tipo_check CHECK (tipo IN ('pix', 'boleto', 'ted', 'extrato_bancario'));
