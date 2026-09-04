-- Achado em aberto (PRs #53-#55): POST /disputas/:id/resolve deixava o próprio cedente
-- encerrar sozinho qualquer disputa aberta contra ele — sem confirmação do sacado, sem
-- revisão do admin, restaurando o aceite pra 'aceita' e liberando cobrança jurídica
-- (lib/legalCollection.ts's checkCollectionEligibility exige aceite 'aceita') só com base
-- na própria palavra do credor interessado. Isso não se sustenta como resolução válida —
-- nem uma transação civil comum dispensa consentimento das duas partes (CC art. 840).
-- Estas colunas guardam uma PROPOSTA de resolução do cedente, que só vira resolução real
-- (disputes.resolved = 1) quando o sacado confirma (routes/disputas.ts) — autocomposição
-- bilateral de verdade, não decisão unilateral do acusado.
ALTER TABLE disputes ADD COLUMN proposed_resolution TEXT;
ALTER TABLE disputes ADD COLUMN proposed_by INTEGER REFERENCES users(id);
ALTER TABLE disputes ADD COLUMN proposed_at TEXT;
