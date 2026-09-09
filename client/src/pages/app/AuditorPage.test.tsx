import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../../lib/i18n';
import { AuditorPage } from './AuditorPage';

// O painel do auditor tinha um bloco servido e nunca desenhado: `disputas` saía de
// lib/auditorOverview.ts, e a interface desta tela não declarava o campo — então a lista
// nunca apareceu. Dado servido e nunca lido é o mesmo que dado ausente pra quem usa o painel,
// e nada quebrava pra denunciar isso.
//
// Este teste existe pra que os dois blocos que vêm do servidor — balcão e disputas — precisem
// estar na tela, e não só no JSON.

const OVERVIEW = {
  auditLog: {
    entries: [{ id: 1, actor: 'Kayrós Capital', action: 'otc.aceita', quando: 'há 2 min', hash: 'abc123def456' }],
    chain: { valid: true, brokenAt: null },
  },
  compliance: { pendentes: 0, itens: [] },
  reconciliation: { abertas: 0, resolvidas: 3, recentes: [] },
  sars: { aberto: 1, descartado: 0, reportado_coaf: 0 },
  disputas: {
    abertas: 1,
    resolvidas: 2,
    recentes: [
      { duplicataId: 'DUP-2026-0999', sacado: 'Grupo Atlas Varejo', cedente: 'Fornecedor Lima', valorFmt: 'R$ 42.000', resolved: false, quando: 'há 1 dia' },
    ],
  },
  otc: {
    abertas: 1,
    aceitas: 2,
    encerradas: 1,
    volumeAceitoFmt: 'R$ 77.000',
    recentes: [
      {
        id: 7,
        duplicataId: 'DUP-2026-0842',
        sacado: 'Grupo Atlas Varejo',
        comprador: 'MesaBeta Capital',
        vendedor: 'MesaAlfa Capital',
        valorFmt: 'R$ 53.000',
        valorFaceFmt: 'R$ 60.000',
        status: 'aceita',
        rodadas: 3,
        quando: 'há 3 h',
      },
    ],
  },
};

function renderAuditor() {
  return render(
    <MemoryRouter>
      <LanguageProvider>
        <AuditorPage />
      </LanguageProvider>
    </MemoryRouter>
  );
}

function stubOverview(payload: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(payload) } as Response))
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AuditorPage — o balcão e as disputas chegam à tela', () => {
  it('desenha a negociação de balcão com as duas partes, o valor negociado e o de face', async () => {
    stubOverview(OVERVIEW);
    renderAuditor();

    await waitFor(() => expect(screen.getByText('Balcão (OTC) — negociação bilateral')).toBeInTheDocument());
    // As duas contrapartes nomeadas: é o que torna a negociação bilateral auditável.
    expect(screen.getByText(/MesaAlfa Capital → MesaBeta Capital/)).toBeInTheDocument();
    // Negociado e face lado a lado — a comparação que denuncia um preço fora de mercado.
    expect(screen.getByText('R$ 53.000')).toBeInTheDocument();
    expect(screen.getByText('R$ 60.000')).toBeInTheDocument();
    expect(screen.getByText(/DUP-2026-0842/)).toBeInTheDocument();
  });

  it('desenha o bloco de disputas que o servidor já servia', async () => {
    stubOverview(OVERVIEW);
    renderAuditor();

    await waitFor(() => expect(screen.getByText('Disputas de aceite')).toBeInTheDocument());
    expect(screen.getByText(/DUP-2026-0999/)).toBeInTheDocument();
    expect(screen.getByText(/Fornecedor Lima/)).toBeInTheDocument();
    expect(screen.getByText('1 abertas · 2 resolvidas')).toBeInTheDocument();
  });

  it('o KPI do balcão mostra o volume que de fato liquidou, não o total proposto', async () => {
    stubOverview(OVERVIEW);
    renderAuditor();

    await waitFor(() => expect(screen.getByText('Balcão liquidado')).toBeInTheDocument());
    expect(screen.getByText('R$ 77.000')).toBeInTheDocument();
    expect(screen.getByText('2 fechadas · 1 em aberto')).toBeInTheDocument();
  });

  it('sem negociação nenhuma, diz que está vazio em vez de sumir com a seção', async () => {
    stubOverview({ ...OVERVIEW, otc: { abertas: 0, aceitas: 0, encerradas: 0, volumeAceitoFmt: 'R$ 0', recentes: [] }, disputas: { abertas: 0, resolvidas: 0, recentes: [] } });
    renderAuditor();

    await waitFor(() => expect(screen.getByText('Nenhuma negociação de balcão')).toBeInTheDocument());
    expect(screen.getByText('Nenhuma disputa')).toBeInTheDocument();
  });
});
