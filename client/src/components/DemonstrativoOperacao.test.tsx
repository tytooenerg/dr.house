import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { DemonstrativoOperacao, useDemonstrativoSimulado, type Demonstrativo } from './DemonstrativoOperacao';

// O exemplo que pediu esta tela: duplicata de R$ 1.000, 30 dias, 2% a.m.
const EXEMPLO: Demonstrativo = {
  linhas: [
    { rotulo: 'Valor da duplicata', detalhe: null, valorFmt: 'R$ 1.000,00', tipo: 'base' },
    { rotulo: 'Deságio do banco/fundo', detalhe: '2,00% a.m. × 30 dias = 2,00%', valorFmt: '− R$ 20,00', tipo: 'menos' },
    { rotulo: 'Banco/fundo paga hoje', detalhe: null, valorFmt: 'R$ 980,00', tipo: 'total' },
    { rotulo: 'Taxa da plataforma Lastro', detalhe: '0,35% sobre o valor da duplicata', valorFmt: '− R$ 3,50', tipo: 'menos' },
    { rotulo: 'Empresa recebe', detalhe: null, valorFmt: 'R$ 976,50', tipo: 'resultado' },
  ],
  rodape: 'No vencimento o banco/fundo recebe R$ 1.000,00 do sacado — ganho de R$ 20,00 (2,04% no período).',
  valorFace: 1000,
  compradorPaga: 980,
  taxaPlataforma: 3.5,
  vendedorRecebe: 976.5,
  ganhoComprador: 20,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DemonstrativoOperacao', () => {
  it('desenha cada linha na ordem, com o detalhe da conta e o rodapé do vencimento', () => {
    render(<DemonstrativoOperacao demonstrativo={EXEMPLO} titulo="Se o seu lance de 2% a.m. vencer" />);
    const conta = screen.getByTestId('demonstrativo');
    expect(conta).toHaveTextContent('Se o seu lance de 2% a.m. vencer');
    expect(conta.textContent).toMatch(/Valor da duplicata.*Deságio do banco\/fundo.*Banco\/fundo paga hoje.*Taxa da plataforma Lastro.*Empresa recebe/);
    expect(screen.getByText('2,00% a.m. × 30 dias = 2,00%')).toBeInTheDocument();
    expect(screen.getByText('R$ 976,50')).toBeInTheDocument();
    expect(screen.getByText(/ganho de R\$ 20,00/)).toBeInTheDocument();
  });
});

function Simulacao({ path }: { path: string | null }) {
  const { demonstrativo } = useDemonstrativoSimulado(path, 10);
  return <div>{demonstrativo ? demonstrativo.linhas[4].valorFmt : 'nada'}</div>;
}

describe('useDemonstrativoSimulado', () => {
  it('sem valor digitado não chama o servidor', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<Simulacao path={null} />);
    await new Promise((r) => setTimeout(r, 30));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText('nada')).toBeInTheDocument();
  });

  it('busca a conta do valor digitado e mostra o resultado', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(EXEMPLO) } as Response));
    vi.stubGlobal('fetch', fetchMock);
    render(<Simulacao path="/market/DUP-1/simulacao?taxaAm=2" />);
    await waitFor(() => expect(screen.getByText('R$ 976,50')).toBeInTheDocument());
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain('/market/DUP-1/simulacao?taxaAm=2');
  });
});
