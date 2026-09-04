import { describe, expect, it } from 'vitest';
import {
  buildCronogramaEstatico,
  classifyCompliance,
  OBRIGATORIEDADE_POR_BRACKET,
  PRODUCAO_ASSISTIDA_INICIO,
  FATURAMENTO_BRACKET_LABELS,
} from '../src/lib/complianceCalendarCore.js';

// Achado corrigido (auditoria de conformidade): o cronograma exibido estaticamente em
// CompliancePage.tsx (via routes/compliance.ts) costumava vir de um array em data/seed.ts
// com datas vagas ("A partir do fim de 2026") — uma segunda fonte de verdade divergente
// da data exata que classifyCompliance/buildComplianceCalendarView já usam pro calendário
// pessoal de cada cedente. buildCronogramaEstatico agora gera as duas visões a partir das
// MESMAS constantes (OBRIGATORIEDADE_POR_BRACKET/PRODUCAO_ASSISTIDA_INICIO) — este teste
// prova que elas não podem mais divergir.

describe('buildCronogramaEstatico — mesma fonte de verdade do calendário pessoal', () => {
  it('cada item de obrigatoriedade cita exatamente o mesmo mês/ano que o calendário pessoal do bracket correspondente', () => {
    const hoje = new Date('2026-08-01T00:00:00Z'); // antes de todas as datas de obrigatoriedade
    const cronograma = buildCronogramaEstatico(hoje);
    const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

    for (const bracket of Object.keys(OBRIGATORIEDADE_POR_BRACKET) as (keyof typeof OBRIGATORIEDADE_POR_BRACKET)[]) {
      const view = classifyCompliance(bracket, hoje);
      expect(view.obrigatorioEmFmt).toBeTruthy();
      const item = cronograma.find((c) => c.label.includes(FATURAMENTO_BRACKET_LABELS[bracket]));
      expect(item).toBeTruthy();
      // O mês/ano citado no cronograma estático bate com a data exata do calendário
      // pessoal (a mesma constante OBRIGATORIEDADE_POR_BRACKET alimenta os dois) — não dá
      // mais pra um cedente ver dois prazos diferentes pro mesmo evento dependendo de
      // qual tela ele olha.
      const data = OBRIGATORIEDADE_POR_BRACKET[bracket];
      const mesAnoEsperado = `${MESES[data.getUTCMonth()]}/${data.getUTCFullYear()}`;
      expect(item!.periodo).toContain(mesAnoEsperado);
    }
  });

  it('marca "Ativo" só depois que a data de fato passou, "Planejado" antes — igual ao calendário pessoal', () => {
    const antesDeTudo = new Date('2026-01-01T00:00:00Z');
    const cronogramaAntes = buildCronogramaEstatico(antesDeTudo);
    expect(cronogramaAntes.find((c) => c.label === 'Adesão voluntária')!.status).toBe('Planejado');
    expect(cronogramaAntes.every((c) => c.label === 'Adesão voluntária' || c.status === 'Planejado')).toBe(true);

    const depoisDaAdesao = new Date(PRODUCAO_ASSISTIDA_INICIO.getTime() + 24 * 3600 * 1000);
    const cronogramaDepois = buildCronogramaEstatico(depoisDaAdesao);
    expect(cronogramaDepois.find((c) => c.label === 'Adesão voluntária')!.status).toBe('Ativo');

    const depoisDeTudo = new Date(OBRIGATORIEDADE_POR_BRACKET.ate_4_8m.getTime() + 24 * 3600 * 1000);
    const cronogramaFinal = buildCronogramaEstatico(depoisDeTudo);
    expect(cronogramaFinal.every((c) => c.status === 'Ativo')).toBe(true);
  });

  it('gera um item por faixa de faturamento, sempre na mesma ordem cronológica', () => {
    const cronograma = buildCronogramaEstatico(new Date('2026-01-01T00:00:00Z'));
    expect(cronograma).toHaveLength(1 + Object.keys(OBRIGATORIEDADE_POR_BRACKET).length);
    const labels = cronograma.map((c) => c.label);
    expect(labels[0]).toBe('Adesão voluntária');
    for (const bracket of Object.keys(OBRIGATORIEDADE_POR_BRACKET)) {
      expect(labels.some((l) => l.includes(FATURAMENTO_BRACKET_LABELS[bracket as keyof typeof FATURAMENTO_BRACKET_LABELS]))).toBe(true);
    }
  });
});
