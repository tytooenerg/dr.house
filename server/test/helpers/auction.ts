import request from 'supertest';
import { app } from '../../src/app.js';
import { dispararLeilao, getDuplicata, setStatus as setDuplicataStatus } from '../../src/db/duplicatas.js';
import { closeDueAuctions } from '../../src/lib/auctionClose.js';
import { reserveRate } from '../../src/lib/auctionCore.js';

// O marketplace primário deixou de vender por "quem clica primeiro a um preço fixo" e passou
// a ser leilão de verdade: o investidor propõe uma taxa e o vencedor sai no fechamento
// (lib/auctionClose.ts). Um teste que antes fazia `POST /market/:id/buy` agora precisa dos
// dois passos, e este helper existe pra isso não virar dez linhas repetidas em 19 arquivos.

/**
 * Garante que a duplicata está em leilão aberto. O antigo `POST /market/:id/buy` não exigia
 * status 'no_mercado' — dava pra comprar uma duplicata só aprovada — então a maioria dos
 * testes nunca chamou dispararLeilao. Com leilão real isso deixou de fazer sentido: não se
 * lança no que não está em leilão. Os testes cujo ASSUNTO é o leilão disparam explicitamente;
 * este atalho existe pros outros, cujo assunto é liquidação, receita ou webhook.
 */
export function garantirLeilao(duplicataId: string) {
  const d = getDuplicata(duplicataId);
  if (!d || d.status === 'no_mercado') return;
  // Uma duplicata emitida com lastro < 100% para em 'pendente_analise' e só um humano a
  // libera (routes/admin.ts, decision 'liberado' => setDuplicataStatus 'aprovada'). É a
  // mesma chamada aqui: os testes de liquidação/receita não são sobre a fila de análise, e
  // com o /buy antigo eles nem passavam por ela — comprava-se em qualquer status.
  if (d.status === 'pendente_analise') setDuplicataStatus(duplicataId, 'aprovada');
  if (getDuplicata(duplicataId)!.status === 'aprovada')
    dispararLeilao(duplicataId, new Date(Date.now() + 3600_000).toISOString());
}

/** Dá um lance na taxa de reserva (o pior deságio que o cedente aceita). */
export async function darLance(token: string, duplicataId: string, taxaAm?: number) {
  garantirLeilao(duplicataId);
  const taxa = taxaAm ?? reserveRate(duplicataId)?.taxaAm;
  return request(app)
    .post(`/api/market/${duplicataId}/lance`)
    .set('Authorization', `Bearer ${token}`)
    .send({ taxaAm: taxa });
}

/**
 * Fecha o leilão de uma duplicata (ou todos, se nenhuma for passada), adjudicando o melhor
 * lance. Passe sempre o id: sem ele o fechamento arrasta junto TODA oferta do marketplace
 * cujo prazo já passou — inclusive as sem lance, que ficam encerradas e derrubam com 409 o
 * próximo teste do mesmo arquivo que tentasse lançar nelas.
 */
export function fecharLeiloes(duplicataId?: string) {
  // O close_at é sempre no futuro quando dispararLeilao roda; avançar o "agora" é o
  // equivalente em teste a esperar o prazo, mesma convenção de applyTacitAcceptance.
  return closeDueAuctions(new Date(Date.now() + 365 * 24 * 3600_000).toISOString(), duplicataId);
}

/**
 * Atalho para "este investidor arremata esta duplicata": lance na reserva + fechamento.
 * Substitui o antigo `POST /market/:id/buy` na maioria dos testes.
 */
export async function arrematar(token: string, duplicataId: string, taxaAm?: number) {
  const lance = await darLance(token, duplicataId, taxaAm);
  if (lance.status !== 200) return { lance, fechamento: null, duplicata: getDuplicata(duplicataId) };
  const fechamento = fecharLeiloes(duplicataId);
  return { lance, fechamento, duplicata: getDuplicata(duplicataId) };
}
