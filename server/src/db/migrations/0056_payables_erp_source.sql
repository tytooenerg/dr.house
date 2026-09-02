-- Contas a pagar via ERP conectado — mesma ideia de erp_receivables (0054), agora pro lado
-- das saídas: Omie/SAP/TOTVS também expõem um módulo de contas a pagar (fornecedores), não
-- só de contas a receber. Ao contrário de um recebível externo (que nunca passou pela
-- esteira de risco da Lastro e por isso leva um deságio na projeção — ver
-- lib/cashflowForecast.ts), uma conta a pagar é a mesma obrigação real de caixa não importa
-- a origem, então entra direto na tabela payables já existente em vez de uma tabela paralela;
-- fonte/external_id só existem pra permitir dedupe num re-fetch (upsert).
ALTER TABLE payables ADD COLUMN fonte TEXT;
ALTER TABLE payables ADD COLUMN external_id TEXT;
-- Parcial: só cobre linhas vindas de ERP (fonte preenchida). Entradas manuais/CSV (fonte
-- NULL) nunca colidem entre si — dedupe só faz sentido quando há um id externo real pra
-- comparar contra.
CREATE UNIQUE INDEX IF NOT EXISTS idx_payables_erp_source ON payables(cedente_id, fonte, external_id) WHERE fonte IS NOT NULL;
