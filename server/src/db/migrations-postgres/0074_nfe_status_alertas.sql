ALTER TABLE compliance_alerts DROP CONSTRAINT compliance_alerts_type_check;
ALTER TABLE compliance_alerts ADD CONSTRAINT compliance_alerts_type_check
  CHECK (type IN ('nfe_duplicidade','valor_anomalo','pld_screening','cnpj_invalido','cnpj_situacao_irregular','nfe_chave_invalida','nfe_situacao_irregular'));
