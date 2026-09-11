-- Duas novas categorias de alerta de compliance para o segundo pilar do lastro real:
-- situação da NF-e junto à SEFAZ (dígito verificador da chave de acesso + status real via
-- provedor configurado — ver lib/nfeStatus.ts). Mesmo padrão de 0073_cnpj_alertas.sql
-- (que por sua vez seguiu 0045_auditor_role.sql): SQLite não altera CHECK com ALTER
-- TABLE, então a tabela é recriada — schema copiado verbatim do atual (0073 + índices de
-- 0047_hot_path_indices.sql).
CREATE TABLE compliance_alerts_new_0074 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK(type IN ('nfe_duplicidade','valor_anomalo','pld_screening','cnpj_invalido','cnpj_situacao_irregular','nfe_chave_invalida','nfe_situacao_irregular')),
  severity TEXT NOT NULL CHECK(severity IN ('info','atencao','critico')),
  message TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id),
  duplicata_id TEXT REFERENCES duplicatas(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO compliance_alerts_new_0074 (id, type, severity, message, user_id, duplicata_id, created_at)
SELECT id, type, severity, message, user_id, duplicata_id, created_at FROM compliance_alerts;

DROP TABLE compliance_alerts;
ALTER TABLE compliance_alerts_new_0074 RENAME TO compliance_alerts;

CREATE INDEX IF NOT EXISTS idx_compliance_alerts_created ON compliance_alerts(created_at);
CREATE INDEX IF NOT EXISTS idx_compliance_alerts_duplicata ON compliance_alerts(duplicata_id);
CREATE INDEX IF NOT EXISTS idx_compliance_alerts_user ON compliance_alerts(user_id);
