-- purchases.valor passa a significar sempre QUANTO O INVESTIDOR PAGOU (base de custo).
--
-- A compra primária (leilão — lib/auctionClose.ts) gravava o valor de FACE da duplicata,
-- enquanto a revenda (lib/resaleCore.ts) gravava o preço pago. Um remendo (face − retorno)
-- consertava a leitura só enquanto a posição estava ativa: ao ser revendida, o retorno é
-- sobrescrito com o ganho realizado, e Carteira & Histórico, o relatório institucional e a
-- performance passavam a mostrar a face como "investido".
--
-- Só as linhas de compra PRIMÁRIA (a primeira de cada duplicata) que ainda guardam a face
-- são tocadas — as de revenda já estão certas, e a condição `valor = face` torna isto seguro
-- de rodar sobre dados já corrigidos. O código novo grava face − retorno, mesmo arredondamento.

-- 1. Posição ainda ativa: retorno ainda é face − preço pago.
UPDATE purchases
   SET valor = (SELECT d.valor FROM duplicatas d WHERE d.id = purchases.duplicata_id) - retorno
 WHERE active = 1
   AND id = (SELECT MIN(p2.id) FROM purchases p2 WHERE p2.duplicata_id = purchases.duplicata_id)
   AND valor = (SELECT d.valor FROM duplicatas d WHERE d.id = purchases.duplicata_id);

-- 2. Posição já revendida (retorno sobrescrito): o preço sai do lance vencedor do leilão.
UPDATE purchases
   SET valor = (SELECT d.valor FROM duplicatas d WHERE d.id = purchases.duplicata_id)
             - ROUND((SELECT d.valor FROM duplicatas d WHERE d.id = purchases.duplicata_id)
                     - (SELECT b.preco FROM auction_bids b
                         WHERE b.duplicata_id = purchases.duplicata_id AND b.bidder_id = purchases.investor_id AND b.status = 'vencedor'
                         ORDER BY b.id DESC LIMIT 1))
 WHERE active = 0
   AND id = (SELECT MIN(p2.id) FROM purchases p2 WHERE p2.duplicata_id = purchases.duplicata_id)
   AND valor = (SELECT d.valor FROM duplicatas d WHERE d.id = purchases.duplicata_id)
   AND EXISTS (SELECT 1 FROM auction_bids b
                WHERE b.duplicata_id = purchases.duplicata_id AND b.bidder_id = purchases.investor_id AND b.status = 'vencedor');

-- 3. Revendida e sem lance de leilão (compras anteriores ao leilão): o que de fato saiu da
--    conta do investidor, no lançamento "Compra da duplicata …" (lib/settlement.ts).
UPDATE purchases
   SET valor = (SELECT -l.valor FROM ledger l
                 WHERE l.user_id = purchases.investor_id AND l.valor < 0
                   AND l.descricao LIKE 'Compra da duplicata ' || purchases.duplicata_id || ' %'
                 ORDER BY l.id ASC LIMIT 1)
 WHERE active = 0
   AND id = (SELECT MIN(p2.id) FROM purchases p2 WHERE p2.duplicata_id = purchases.duplicata_id)
   AND valor = (SELECT d.valor FROM duplicatas d WHERE d.id = purchases.duplicata_id)
   AND EXISTS (SELECT 1 FROM ledger l
                WHERE l.user_id = purchases.investor_id AND l.valor < 0
                  AND l.descricao LIKE 'Compra da duplicata ' || purchases.duplicata_id || ' %');
