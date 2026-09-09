import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Dois controles diferentes na MESMA tela não podem se anunciar com o mesmo nome.
//
// Uma passada anterior de acessibilidade garantiu que todo controle TEM nome (aria-label ou
// texto visível). Ela não checou colisão — e nome sem unicidade não resolve o problema que o
// nome existe pra resolver. Quem navega por leitor de tela ouve só o nome acessível, sem o
// cartão em volta, sem o título da seção, sem a coluna: três botões "Sacar" viram três botões
// idênticos, e um deles manda dinheiro por um rail que não era o pretendido.
//
// O primeiro caso apareceu por acidente: um teste de página falhou com
// `getMultipleElementsFoundError` porque a tela de ERP tinha dois "Remover" — o da marca e o do
// domínio. Isto aqui procura o resto.
//
// Escopo e limites: analisa o TEXTO-FONTE de cada página e só enxerga `<Button>` com rótulo
// literal (ou `aria-label` literal). Não resolve rótulo vindo de variável, de `t()` ou de
// ternário, e não sabe se dois controles estão em ramos mutuamente exclusivos — por isso a
// lista de exceções abaixo existe e exige motivo. É uma rede grossa que pega o caso comum, não
// uma auditoria de acessibilidade.

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'pages');

function listarPaginas(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return listarPaginas(p);
    return e.isFile() && e.name.endsWith('.tsx') && !e.name.endsWith('.test.tsx') ? [p] : [];
  });
}

/** Nome acessível de um `<Button>`: o aria-label quando existe, senão o texto literal. */
function nomesDeBotao(fonte: string): string[] {
  const nomes: string[] = [];
  const re = /<Button\b([^>]*)>\s*([^<{}\n][^<{}]*?)\s*<\/Button>/gs;
  for (const m of fonte.matchAll(re)) {
    const aria = /aria-label="([^"]+)"/.exec(m[1]);
    const nome = aria ? aria[1] : m[2].replace(/\s+/g, ' ').trim();
    if (nome) nomes.push(nome);
  }
  return nomes;
}

/**
 * Colisões toleradas. Cada uma precisa de motivo escrito — sem isso a lista vira o lugar onde
 * os achados morrem, que é o oposto do que este teste existe pra fazer.
 */
const TOLERADAS: Record<string, Record<string, string>> = {};

describe('nomes acessíveis: dois controles da mesma tela nunca compartilham nome', () => {
  const paginas = listarPaginas(raiz);

  it('existem páginas pra analisar (a varredura não pode passar por não achar nada)', () => {
    expect(paginas.length).toBeGreaterThan(20);
  });

  it.each(paginas.map((p) => [path.relative(raiz, p), p] as const))('%s', (relativo, absoluto) => {
    const nomes = nomesDeBotao(fs.readFileSync(absoluto, 'utf8'));
    const contagem = new Map<string, number>();
    for (const n of nomes) contagem.set(n, (contagem.get(n) ?? 0) + 1);

    const toleradas = TOLERADAS[relativo] ?? {};
    const colisoes = [...contagem.entries()].filter(([nome, n]) => n > 1 && !(nome in toleradas)).map(([nome, n]) => `${nome} (×${n})`);

    expect(
      colisoes,
      `${relativo} tem controles que se anunciam com o mesmo nome: ${colisoes.join(', ')}. ` +
        `Dê a cada um um aria-label que diga o que ELE faz ("Sacar via Pix", "Conectar Omie"), ou registre a exceção em TOLERADAS com o motivo.`
    ).toEqual([]);
  });
});
