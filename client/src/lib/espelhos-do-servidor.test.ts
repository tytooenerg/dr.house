import { describe, expect, it } from 'vitest';
// Importação REAL do servidor, não uma cópia: server/src/data/seed.ts não tem um único
// import, é dado puro, então o teste compara valores de verdade em vez de casar texto com
// regex. Isto nunca entra no bundle do app — só o Vitest resolve este caminho.
import { INSURERS, ROLE_TABS, WEBHOOK_EVENTS } from '../../../server/src/data/seed';
import { INSURER_OPTIONS } from '../pages/auth/LoginPage';
import { WEBHOOK_EVENTS as WEBHOOK_EVENTS_DOCS } from '../pages/public/DocsPage';
import { NAV_ITEMS } from '../data/navConfig';

// O client mantém alguns ESPELHOS de constantes do servidor — listas copiadas à mão porque a
// tela precisa delas antes de qualquer chamada autenticada (o cadastro, a doc pública). Cada
// espelho é uma divergência esperando acontecer, e uma delas já aconteceu: até o PR do balcão,
// a lista de eventos de webhook do servidor e a da tela de documentação discordavam, e nada
// quebrava — a doc pública anunciava eventos que o Zod da rota recusava, e depois o servidor
// ganhou quatro eventos que a doc não mostrava.
//
// Enquanto os espelhos existirem, eles precisam de uma trava. Não é possível o client
// simplesmente importar do servidor em produção (o bundle arrastaria código de servidor), mas
// o TESTE pode — e é exatamente aqui que a divergência tem que doer.

describe('espelhos do servidor no client', () => {
  it('a lista de eventos de webhook da doc pública é a mesma que o servidor aceita assinar', () => {
    // Ordem não importa (as duas listas são renderizadas/validadas como conjunto), conteúdo sim.
    expect([...WEBHOOK_EVENTS_DOCS].sort()).toEqual([...WEBHOOK_EVENTS].sort());
  });

  it('as seguradoras oferecidas no cadastro são exatamente as que a plataforma tem', () => {
    // O cadastro mostra só key+name; o resto (prêmio, selo) chega pela API depois do login.
    expect(INSURER_OPTIONS.map((i) => i.key).sort()).toEqual(INSURERS.map((i) => i.key).sort());
    for (const opcao of INSURER_OPTIONS) {
      expect(opcao.name).toBe(INSURERS.find((i) => i.key === opcao.key)!.name);
    }
  });

  it('toda tab que o servidor libera pra um papel tem um item de menu — senão a rota existe e ninguém a alcança', () => {
    const chaves = new Set(NAV_ITEMS.map((i) => i.key));
    const semItem: string[] = [];
    for (const [papel, tabs] of Object.entries(ROLE_TABS)) {
      for (const tab of tabs) if (!chaves.has(tab)) semItem.push(`${papel}:${tab}`);
    }
    expect(semItem).toEqual([]);
  });

  it('nenhum item de menu aponta pra uma tab que nenhum papel enxerga — item morto no menu', () => {
    const liberadas = new Set(Object.values(ROLE_TABS).flat());
    const orfaos = NAV_ITEMS.filter((i) => !liberadas.has(i.key)).map((i) => i.key);
    expect(orfaos).toEqual([]);
  });
});
