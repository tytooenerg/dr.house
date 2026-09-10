import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../../lib/i18n';
import { MinhasPage } from './MinhasPage';

// A trava de contrato (server/test/contrato-payload-tela.test.ts) garante que o campo é
// MENCIONADO nesta página. Só um teste de página garante que ele vira tela com o valor certo —
// e é aqui que o leilão do cedente é de fato conferido.
//
// Por que este arquivo existe: a disputa era desenhada só no card do marketplace, pra quem
// compete. O dono da duplicata recebia "No mercado" e mais nada.

const BASE = {
  id: 'DUP-2026-1000-aaaa',
  sacado: 'Grupo Atlas Varejo',
  valorFmt: 'R$ 40.000',
  emissao: '01/09/2026',
  vencimento: '20/12/2026',
  lastroFmt: '100%',
  lastroColor: '#0A5C36',
  status: 'No mercado',
  statusBg: '#E9EEFB',
  statusColor: '#1E5EFF',
  canDisparar: false,
  aguardandoAceite: false,
  reservaSugeridaAm: 2.1,
  reservaTaxaAm: 3,
  precoEstimadoFmt: 'R$ 37.900',
  leilao: null as unknown,
};

const ESCADA = {
  totalLances: 2,
  melhorTaxaFmt: '1,90%',
  melhorPrecoFmt: 'R$ 38.240',
  fechaEm: '5h 12min',
  fechaEmSec: 18_720,
  lances: [
    { id: 2, empresa: 'Fundo Bandeirantes', veiculo: 'FIDC', taxaFmt: '1,90%', precoFmt: 'R$ 38.240', isMelhor: true },
    { id: 1, empresa: 'Fundo Aurora', veiculo: 'Factoring / fomento mercantil', taxaFmt: '2,50%', precoFmt: 'R$ 37.500', isMelhor: false },
  ],
};

function renderMinhas(duplicatas: unknown[]) {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ duplicatas }) } as Response)));
  return render(
    <MemoryRouter>
      <LanguageProvider>
        <MinhasPage />
      </LanguageProvider>
    </MemoryRouter>
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('MinhasPage — o leilão da própria duplicata', () => {
  it('mostra quantos financiadores disputam, a melhor taxa e o que ela paga', async () => {
    renderMinhas([{ ...BASE, leilao: ESCADA }]);

    await waitFor(() => expect(screen.getByText('2 financiadores')).toBeInTheDocument());
    // A taxa sozinha não responde a pergunta do cedente; o preço responde.
    expect(screen.getAllByText('1,90%').length).toBeGreaterThan(0);
    expect(screen.getAllByText('R$ 38.240').length).toBeGreaterThan(0);
    expect(screen.getByText('5h 12min')).toBeInTheDocument();
  });

  it('a escada abre com quem está lançando e sob qual veículo', async () => {
    renderMinhas([{ ...BASE, leilao: ESCADA }]);
    await waitFor(() => expect(screen.getByRole('button', { name: /Ver a disputa/ })).toBeInTheDocument());

    // Fechada por padrão: o resumo já responde "estão brigando pela minha duplicata?".
    expect(screen.queryByText('Fundo Bandeirantes')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Ver a disputa/ }));
    expect(screen.getByText('Fundo Bandeirantes')).toBeInTheDocument();
    expect(screen.getByText('Fundo Aurora')).toBeInTheDocument();
    // O regime sob o qual o crédito seria adquirido — banco, FIDC, fundo e factoring são
    // coisas diferentes, e quem está vendendo tem direito de saber antes do leilão fechar.
    expect(screen.getByText(/FIDC/)).toBeInTheDocument();
    expect(screen.getByText(/Factoring/)).toBeInTheDocument();
  });

  it('leilão aberto sem lance nenhum diz isso, em vez de fingir disputa', async () => {
    renderMinhas([{ ...BASE, leilao: { ...ESCADA, totalLances: 0, melhorTaxaFmt: null, melhorPrecoFmt: null, lances: [] } }]);
    await waitFor(() => expect(screen.getByText(/Nenhum lance ainda/)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Ver a disputa/ })).not.toBeInTheDocument();
  });

  it('fora do leilão não desenha disputa nenhuma', async () => {
    renderMinhas([{ ...BASE, status: 'Aprovada', leilao: null }]);
    await waitFor(() => expect(screen.getByText('Grupo Atlas Varejo')).toBeInTheDocument());
    expect(screen.queryByText(/disputando/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Nenhum lance ainda/)).not.toBeInTheDocument();
  });

  it('diz o que está travando a duplicata em vez de só esconder o botão', async () => {
    renderMinhas([{ ...BASE, status: 'Aprovada', leilao: null, canDisparar: false, aguardandoAceite: true }]);
    await waitFor(() => expect(screen.getByText(/Aguardando o aceite do sacado/)).toBeInTheDocument());
  });

  it('a simulação aparece em reais na hora de escolher a reserva', async () => {
    renderMinhas([{ ...BASE, status: 'Aprovada', leilao: null, canDisparar: true }]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Disparar leilão' })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Disparar leilão' }));
    expect(screen.getByText(/R\$ 37\.900/)).toBeInTheDocument();
  });
});
