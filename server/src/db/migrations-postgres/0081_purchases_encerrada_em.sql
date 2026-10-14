-- Quando uma posição foi encerrada por revenda. Sem isso, o DARF, o Informe de Rendimentos,
-- o agente fiscal e a performance usavam o VENCIMENTO da duplicata como data do resgate até
-- para quem já tinha saído antes, vendendo no mercado secundário: o ganho realizado caía no
-- mês/ano errado e a alíquota da tabela regressiva saía pelo prazo errado.
ALTER TABLE purchases ADD COLUMN encerrada_em TEXT;

-- Posições já encerradas: a revenda cria, no mesmo instante, a compra do novo dono — a
-- próxima linha da mesma duplicata (lib/resaleCore.ts's executeResaleTrade).
UPDATE purchases
   SET encerrada_em = (SELECT MIN(p2.created_at) FROM purchases p2
                        WHERE p2.duplicata_id = purchases.duplicata_id AND p2.id > purchases.id)
 WHERE active = 0 AND encerrada_em IS NULL;
