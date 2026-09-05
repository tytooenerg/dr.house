-- Leilão real no marketplace primário.
--
-- Até aqui o "leilão" era encenação: não havia tabela de lances, POST /market/:id/buy não
-- aceitava preço nenhum (o valor era sempre computePurchasePrice no servidor) e os
-- concorrentes exibidos vinham de BID_TEMPLATES/EXTRA_BIDDERS em data/seed.ts — oito nomes
-- inventados, incluindo instituições reais ("Itaú BBA Recebíveis", "BTG Pactual Crédito"),
-- revelados num cronômetro com taxas geradas por fórmula. Na prática era "quem clica
-- primeiro leva", a preço fixo.
--
-- Espelha resale_bids (0033_secondary_market_depth.sql), que já é a mecânica de lance real
-- do mercado secundário: mesma máquina de estados, mesmos índices.
--
-- `taxa_am` é o deságio mensal que o investidor propõe. MENOR taxa = cedente recebe mais =
-- lance melhor. `preco` é o que esse deságio implica em reais, congelado no momento do
-- lance para o vencedor não ser reprecificado por variação de liquidez entre o lance e o
-- fechamento (ver computePurchasePrice em lib/marketCompute.ts).
CREATE TABLE IF NOT EXISTS auction_bids (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  duplicata_id TEXT NOT NULL REFERENCES duplicatas(id),
  bidder_id INTEGER NOT NULL REFERENCES users(id),
  taxa_am REAL NOT NULL,
  preco REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'ativo' CHECK(status IN ('ativo','vencedor','perdedor','cancelado')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_auction_bids_duplicata ON auction_bids(duplicata_id, status);
CREATE INDEX IF NOT EXISTS idx_auction_bids_bidder ON auction_bids(bidder_id, status);

-- Marca o instante em que o job de fechamento adjudicou o leilão, para não readjudicar e
-- para o histórico saber distinguir "ainda aberto" de "fechou sem lance elegível".
ALTER TABLE duplicatas ADD COLUMN leilao_fechado_em TEXT;

-- Uma duplicata que entrou no mercado antes desta migração pode não ter close_at (o campo
-- só passou a ser obrigatório com o leilão de verdade). Sem prazo, listAuctionsToClose nunca
-- a pega e ela ficaria em leilão para sempre — dar 24h a partir de agora é o menor prazo
-- honesto pra ela ainda receber lances antes de ser adjudicada.
-- strftime com 'T'/'Z' e não datetime(): close_at é comparado como string ISO-8601 em
-- listAuctionsToClose, e o formato com espaço do datetime() ordena antes do 'T' do mesmo dia.
UPDATE duplicatas SET close_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+24 hours')
 WHERE status = 'no_mercado' AND close_at IS NULL;
