-- Vincula um upload a uma duplicata específica. Hoje o instrumento de cessão
-- (kind='contrato_cessao') e qualquer outro documento enviado ficam presos só à conta de
-- quem enviou, sem registro de qual duplicata/operação eles realmente comprovam — o que
-- torna impossível, depois do envio, saber "esse contrato é sobre qual duplicata?". Nullable:
-- a maioria dos uploads (kyb_doc, selfie_liveness, contratos genéricos lidos na tela de
-- Compliance) nunca foi sobre uma duplicata específica e continua sem essa referência.
ALTER TABLE uploads ADD COLUMN duplicata_id TEXT REFERENCES duplicatas(id);
