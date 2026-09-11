import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { computeEmitirPreview } from '../src/lib/emitirCore.js';
import { chooseRegistradora, REGISTRADORAS } from '../src/lib/registradoras.js';
import { listInsuranceQuotes } from '../src/lib/insuranceQuotes.js';
import { buildDashboard } from '../src/lib/dashboardCore.js';
import { getUserByEmail } from '../src/db/users.js';
import { listAllDuplicatas } from '../src/db/duplicatas.js';
import { vencimentoFuturo } from './helpers/datas.js';

// Achados da varredura pelos seis papéis, bloco do cedente: três números que a tela dizia e
// o sistema não cumpria.

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

describe('o número dentro do anel descreve o anel', () => {
  it('donutCount conta o que foi distribuído, não um subconjunto filtrado', async () => {
    // O cedente demo tem duplicatas em vários status; o donut soma TODAS por valor, mas o
    // centro mostrava só as ativas — daí "3 operações" cercado por quatro faixas não-nulas,
    // que é impossível com 3 itens.
    const ced = getUserByEmail('cedente@lastro.demo')!;
    const view = buildDashboard(ced, listAllDuplicatas());

    expect(view.donutCount).toBeGreaterThan(0);
    // Quantas faixas têm percentual maior que zero não pode passar do número de itens.
    const faixasNaoNulas = view.ratingLegend.filter((l) => parseFloat(l.pct.replace(',', '.')) > 0).length;
    expect(faixasNaoNulas).toBeLessThanOrEqual(view.donutCount);
    // E o centro não é mais o subconjunto filtrado, quando os dois divergem.
    if (view.activeDuplicatas !== view.donutCount) {
      expect(view.donutCount).toBeGreaterThan(view.activeDuplicatas);
    }
  });

  it('vale para os quatro papéis que usam o mesmo componente', async () => {
    for (const email of ['investidor@lastro.demo', 'cedente@lastro.demo', 'sacado@lastro.demo', 'admin@lastro.demo']) {
      const u = getUserByEmail(email)!;
      const view = buildDashboard(u, listAllDuplicatas());
      const faixasNaoNulas = view.ratingLegend.filter((l) => parseFloat(l.pct.replace(',', '.')) > 0).length;
      expect(faixasNaoNulas, `${email}: mais faixas que itens no anel`).toBeLessThanOrEqual(view.donutCount);
    }
  });
});

describe('o prêmio do seguro na emissão', () => {
  const base = { sacado: 'Grupo Atlas Varejo', cnpj: '12.345.678/0001-95', valor: '84.500', vencimento: vencimentoFuturo(), nfAnexada: true, nfeChave: '', batchValores: [] };

  it('mostra a faixa real das cotações desta duplicata, não um percentual fixo', () => {
    const preview = computeEmitirPreview({ ...base, seguro: true });
    const cotacoes = listInsuranceQuotes({ score: 84, valor: 84500, vencimento: vencimentoFuturo() });
    const menor = 84500 * (cotacoes[0].premioPct / 100);
    const maior = 84500 * (cotacoes[cotacoes.length - 1].premioPct / 100);

    // A faixa exibida tem que ser a das cotações reais — que, para este risco, não é 0,6%.
    expect(preview.emitSummary.premioFmt).toContain(Math.round(menor).toLocaleString('pt-BR'));
    expect(preview.emitSummary.premioFmt).toContain(Math.round(maior).toLocaleString('pt-BR'));
    // O 0,6% fixo que aparecia antes: 84.500 × 0,006 = 507.
    expect(preview.emitSummary.premioFmt).not.toBe('R$ 507');
    // E as seguradoras discordam de verdade — se não discordassem, a faixa seria um ponto.
    expect(cotacoes[0].premioPct).not.toBe(cotacoes[cotacoes.length - 1].premioPct);
  });

  it('diz que quem paga é o investidor, não o cedente', () => {
    const preview = computeEmitirPreview({ ...base, seguro: true });
    expect(preview.emitSummary.premioPagoPor).toBe('investidor');
    expect(preview.emitSummary.premioNota).toMatch(/investidor/i);
    expect(preview.emitSummary.premioNota).toMatch(/não sai do seu valor/i);
  });

  it('sem seguro, não promete nem cobra nada', () => {
    const preview = computeEmitirPreview({ ...base, seguro: false });
    expect(preview.emitSummary.premioFmt).toBe('Não oferecido');
  });

  it('emitir com seguro não contrata apólice nem cobra prêmio de ninguém', async () => {
    // O flag da emissão só marca a duplicata como elegível. A prova: depois de emitir com
    // seguro=true, nenhuma seguradora está atribuída — a contratação é do investidor.
    const email = `ced-varr-${unique()}@example.com`;
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ nome: 'Cedente Varredura', email, password: 'senha123', companyName: `Cedente Varr ${unique()}`, role: 'cedente' });
    let duplicataId = '';
    for (let i = 0; i < 8 && !duplicataId; i++) {
      const res = await request(app)
        .post('/api/emitir/submit')
        .set('Authorization', `Bearer ${reg.body.token}`)
        .send({ ...base, seguro: true });
      if (res.status === 200) duplicataId = res.body.duplicataId;
    }
    expect(duplicataId).not.toBe('');

    const { getDuplicata } = await import('../src/db/duplicatas.js');
    const { getLatestInsuranceSettlement } = await import('../src/db/insuranceSettlements.js');
    expect(getDuplicata(duplicataId)!.seguro).toBe(1);
    expect(getDuplicata(duplicataId)!.insurer_key).toBeNull();
    expect(getLatestInsuranceSettlement(duplicataId)).toBeUndefined();
  });
});

describe('a registradora anunciada é a que será usada', () => {
  const base = { sacado: 'Grupo Atlas Varejo', cnpj: '12.345.678/0001-95', vencimento: vencimentoFuturo(), seguro: false, nfAnexada: true, nfeChave: '', batchValores: [] };

  it('nomeia UMA registradora, a que chooseRegistradora escolhe para este valor', () => {
    const preview = computeEmitirPreview({ ...base, valor: '84.500' });
    expect(preview.emitSummary.registradoraEscolhida).toBe(chooseRegistradora(84500).name);
    // A tela listava três fixas; agora é uma só.
    expect(preview.emitSummary.registradoraEscolhida).not.toContain('·');
  });

  it('até R$ 200 mil a escolhida é a mais barata — que não estava na lista fixa da tela', () => {
    const escolhida = chooseRegistradora(150000);
    const maisBarata = REGISTRADORAS.reduce((m, r) => (r.custoPct < m.custoPct ? r : m));
    expect(escolhida.key).toBe(maisBarata.key);
    // "CERC · B3 · Núclea" era o que a tela prometia, e a escolhida real não é nenhuma delas.
    expect(['cerc', 'b3', 'nucleo']).not.toContain(escolhida.key);
    expect(computeEmitirPreview({ ...base, valor: '150.000' }).emitSummary.registradoraEscolhida).toBe(escolhida.name);
  });

  it('acima de R$ 200 mil a elegibilidade muda, e o preview acompanha', () => {
    const preview = computeEmitirPreview({ ...base, valor: '500.000' });
    expect(preview.emitSummary.registradoraEscolhida).toBe(chooseRegistradora(500000).name);
    // Faixa alta exige confiabilidade ≥ 99%, então a escolha muda de fato.
    expect(chooseRegistradora(500000).key).not.toBe(chooseRegistradora(150000).key);
  });
});
