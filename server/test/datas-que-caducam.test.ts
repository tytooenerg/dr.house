import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Uma data fixa no futuro é uma bomba-relógio com pavio silencioso.
//
// `server/src/db/seed.ts` já tinha aprendido isso e escrito no `daysFromNow()`: *"a fixed
// future date eventually becomes a fixed past one"*. Os testes não seguiram, e em 10/09/2026 a
// conta chegou — três testes de sinistro amanheceram vermelhos porque emitiam com
// `vencimento: '2026-09-10'` sob o comentário "ainda no futuro no momento da contratação do
// seguro". A data não mudou; o mundo andou até ela.
//
// O que torna isso pior que um bug comum: ninguém tocou em nada. A suíte fica verde por meses,
// um dia amanhece vermelha, e um deploy legítimo trava por causa do calendário — no pior
// momento possível, que é quando alguém está com pressa para subir.
//
// Esta trava não conserta as datas; ela AVISA antes de doer. Uma data literal de vencimento no
// futuro precisa estar a mais de 60 dias de distância, então quem escrever uma data curta é
// avisado na hora, e as que já existem passam a falhar com dois meses de antecedência — tempo
// de sobra para trocar por `vencimentoFuturo()` sem pressa.
//
// Datas no passado não entram: uma duplicata de 2020 é vencida hoje e continuará vencida para
// sempre. Só o futuro caduca.

const dirTestes = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const DIAS_MINIMOS = 60;

function arquivosDeTeste(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return arquivosDeTeste(p);
    return e.isFile() && e.name.endsWith('.ts') ? [p] : [];
  });
}

interface Achado {
  arquivo: string;
  linha: number;
  data: string;
  diasRestantes: number;
}

function datasQueVaoCaducar(): Achado[] {
  const hoje = Date.now();
  const achados: Achado[] = [];
  for (const arquivo of arquivosDeTeste(dirTestes)) {
    // O próprio arquivo desta trava cita datas de exemplo nos comentários.
    if (arquivo.endsWith('datas-que-caducam.test.ts')) continue;
    const linhas = fs.readFileSync(arquivo, 'utf8').split('\n');
    linhas.forEach((linha, i) => {
      for (const m of linha.matchAll(/vencimento:\s*'(\d{4}-\d{2}-\d{2})'/g)) {
        const dias = Math.round((new Date(`${m[1]}T00:00:00Z`).getTime() - hoje) / 86_400_000);
        if (dias > 0 && dias <= DIAS_MINIMOS) {
          achados.push({ arquivo: path.relative(dirTestes, arquivo), linha: i + 1, data: m[1], diasRestantes: dias });
        }
      }
    });
  }
  return achados;
}

describe('datas fixas de vencimento não podem caducar no meio do caminho', () => {
  it('a varredura encontra os arquivos (não pode passar por não achar nada)', () => {
    expect(arquivosDeTeste(dirTestes).length).toBeGreaterThan(50);
  });

  it(`nenhuma data literal de vencimento está a menos de ${DIAS_MINIMOS} dias de virar passado`, () => {
    const achados = datasQueVaoCaducar();
    const detalhe = achados.map((a) => `${a.arquivo}:${a.linha} → ${a.data} (faltam ${a.diasRestantes} dias)`);

    expect(
      detalhe,
      `Estas datas de vencimento viram passado em menos de ${DIAS_MINIMOS} dias e vão derrubar os testes que ` +
        `dependem delas serem futuro:\n  ${detalhe.join('\n  ')}\n` +
        `Troque por \`vencimentoFuturo()\` (test/helpers/datas.ts) — data relativa a hoje, que nunca caduca.`
    ).toEqual([]);
  });
});
