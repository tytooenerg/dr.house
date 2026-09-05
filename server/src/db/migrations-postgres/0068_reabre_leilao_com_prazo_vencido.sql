-- Destrava duplicata que ficou sem leilão possível depois da 0067.
--
-- Antes do leilão de verdade, `close_at` era decorativo: alimentava um cronômetro que não
-- decidia nada, e nenhuma duplicata era adjudicada quando ele vencia. A 0067 deu prazo novo
-- só a quem estava com `close_at` NULL — mas a instalação típica tinha o campo PREENCHIDO,
-- com um prazo desses, quase sempre já vencido. Resultado no upgrade: toda oferta do
-- marketplace virou "leilão encerrado" no primeiro boot, sem nunca ter tido um leilão real
-- contra aquele prazo, e nenhum investidor conseguia dar lance em nada.
--
-- A correção dá um prazo REAL de 24h em vez de devolver a duplicata pro cedente. O cedente
-- colocou aquela duplicata no mercado e, no código antigo, ela ficava lá até alguém comprar;
-- tirá-la de mercado no upgrade contrariaria essa intenção e esvaziaria o marketplace de
-- toda instalação existente de uma vez. Com prazo real ela continua onde o cedente pôs, e
-- agora dá pra disputar de verdade — se ninguém lançar em 24h, aí sim ela volta pro cedente
-- pelo caminho normal (lib/auctionClose.ts).
--
-- `leilao_fechado_em` volta a NULL junto: quem subiu a versão nova antes desta migração já
-- pode ter tido o leilão carimbado como encerrado pelo job, pelo mesmo motivo errado.
-- Nada vendido passa por aqui — uma duplicata negociada sai de 'no_mercado'.
UPDATE duplicatas
   SET close_at = to_char(now() + interval '+24 hours', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
       leilao_fechado_em = NULL
 WHERE status = 'no_mercado'
   AND (close_at IS NULL OR close_at <= to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
