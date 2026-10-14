-- O KYB documental passa a valer pra cedentes também (não só investidores), gatekeepeando
-- a emissão de duplicata (lib/emitirCore.ts) em vez do acesso ao app inteiro. Sem este
-- backfill, toda conta cedente já existente ficaria presa: createUser nunca grava
-- kyb_status explicitamente, então ele sempre caiu no DEFAULT 'none' da coluna (migração
-- 0004) — nunca importou antes porque nenhum gate olhava pra isso em ações de cedente.
-- Este UPDATE roda uma vez só, aprovando quem já estava cadastrado até aqui; só contas
-- cedente criadas DEPOIS desta migração nascem precisando enviar os documentos de verdade.
UPDATE users SET kyb_status = 'approved', kyb_done = 1 WHERE role = 'cedente' AND kyb_status != 'approved';
