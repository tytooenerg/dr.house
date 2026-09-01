-- Remove o fundo de garantia (0036_guarantee_fund.sql, 0052_guarantee_fund_tranches.sql).
--
-- Decisão de produto: a Lastro é infraestrutura que conecta cedente/investidor/sacado/
-- seguradora — não assume risco de crédito com capital próprio (ver o prompt do chat da
-- Lastro, que já declara isso). O fundo, porém, capitalizava sua reserva-base com 10% da
-- própria taxa de plataforma da Lastro (FUND_CONTRIBUTION_PCT em lib/guaranteeFund.ts) e
-- usava esse capital como primeira camada de perda em duplicata sem seguro — exatamente o
-- risco de crédito que o modelo de negócio diz que a Lastro não carrega. A seguradora
-- (lib/seguradoraCore.ts) já é o mecanismo real de transferência de risco pra quem quer
-- proteção; uma duplicata sem seguro agora fica honestamente sem cobertura, decisão do
-- investidor que a comprou.
DROP TABLE IF EXISTS guarantee_fund_tranche_quota_movements;
DROP TABLE IF EXISTS guarantee_fund_tranche_ledger;
DROP TABLE IF EXISTS guarantee_fund_claims;
DROP TABLE IF EXISTS guarantee_fund_ledger;
