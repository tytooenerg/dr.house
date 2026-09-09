import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TRANSLATIONS_EN } from './i18n';
import { NAV_ITEMS, NAV_GROUPS } from '../data/navConfig';

// O escopo da tradução é deliberadamente parcial, e o cabeçalho de i18n.tsx explica quais
// partes entram (chrome público, menu, cabeçalhos/rótulos/botões das telas principais) e
// quais ficam em PT-BR de propósito (corpo de página, formulários, e todo DADO vindo do
// servidor). Isso não é o que este teste guarda.
//
// O que ele guarda é a outra frase do mesmo comentário: "Every key present here has a real
// translation on both sides". Chamar `t('alguma.chave', 'Texto')` é declarar que aquele
// pedaço ENTRA no escopo — e o `?? ptDefault` faz a falta da tradução sumir em silêncio, sem
// erro, sem chave crua na tela, sem nada. Foi assim que quinze chaves acumularam: quatro abas
// do admin, os filtros do marketplace, o `nav.docs` e duas do painel de auditoria (estas
// últimas adicionadas junto com o balcão, sem o par em inglês).
//
// Decidir que algo fica em português é legítimo. O jeito de dizer isso é NÃO chamar `t()` —
// escrever o texto direto, como as centenas de strings que corretamente não passam por aqui.
// Chamar `t()` e não traduzir não é uma decisão, é um esquecimento que não dói.

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function arquivosDoClient(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return arquivosDoClient(p);
    return e.isFile() && /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}

/**
 * Toda chave passada a `t()`, com o arquivo onde aparece.
 *
 * O menu monta as suas chaves em runtime — `t(`app.${item.key}`, item.label)` no Sidebar e no
 * TopBar — então elas não existem como literal em lugar nenhum. Resolvê-las a partir da mesma
 * fonte que o menu usa (NAV_ITEMS/NAV_GROUPS) é o que torna a checagem de órfãs honesta: sem
 * isso, trinta traduções vivas apareceriam como mortas e a assertion viraria ruído.
 */
function chavesUsadas(): Map<string, string> {
  const achadas = new Map<string, string>();
  for (const arquivo of arquivosDoClient(raiz)) {
    const fonte = fs.readFileSync(arquivo, 'utf8');
    for (const m of fonte.matchAll(/\bt\(\s*'([a-zA-Z0-9._-]+)'/g)) {
      if (!achadas.has(m[1])) achadas.set(m[1], path.relative(raiz, arquivo));
    }
  }
  for (const item of NAV_ITEMS) achadas.set(`app.${item.key}`, 'layout/Sidebar.tsx (dinâmica)');
  for (const grupo of NAV_GROUPS) achadas.set(`group.${grupo}`, 'layout/Sidebar.tsx (dinâmica)');
  return achadas;
}

describe('traduções: chamar t() é declarar que o pedaço entra no escopo', () => {
  const usadas = chavesUsadas();

  it('a varredura encontra as chaves (não pode passar por não achar nada)', () => {
    expect(usadas.size).toBeGreaterThan(50);
  });

  it('toda chave usada tem entrada em inglês — sem isso o t() cai pro português em silêncio', () => {
    const semTraducao = [...usadas.entries()]
      .filter(([chave]) => !(chave in TRANSLATIONS_EN))
      .map(([chave, arquivo]) => `${chave} (${arquivo})`);

    expect(
      semTraducao,
      `Estas chaves são chamadas via t() e não têm tradução em inglês:\n  ${semTraducao.join('\n  ')}\n` +
        `Ou você traduz, ou o texto não deveria passar por t() — escreva-o direto, como as centenas de strings que ficam em PT-BR de propósito.`
    ).toEqual([]);
  });

  it('nenhuma tradução sobra sem quem a use — entrada órfã envelhece sem ninguém notar', () => {
    const orfas = Object.keys(TRANSLATIONS_EN).filter((chave) => !usadas.has(chave));
    expect(orfas, `Traduções sem nenhum t() correspondente: ${orfas.join(', ')}`).toEqual([]);
  });
});
