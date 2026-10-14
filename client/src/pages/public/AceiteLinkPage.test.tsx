import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AceiteLinkPage } from './AceiteLinkPage';

const RESUMO = {
  duplicataId: 'DUP-2026-1001-abcd',
  emitente: 'Metalúrgica Alfa Ltda',
  sacado: 'Supermercado Beta Ltda',
  valorFmt: 'R$ 100.000',
  emissao: '10/10/2026',
  vencimento: '2026-12-09',
  nfeChave: null,
  registro: 'CERC-123',
  prazoAte: '25/10/2026',
  cnpjConhecido: true,
};

function resposta(status: number, body: unknown) {
  return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) } as Response);
}

function renderPagina() {
  return render(
    <MemoryRouter initialEntries={['/aceite/tok123']}>
      <Routes>
        <Route path="/aceite/:token" element={<AceiteLinkPage />} />
      </Routes>
    </MemoryRouter>
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AceiteLinkPage — o sacado responde sem conta', () => {
  it('mostra a duplicata e confirma, enviando CNPJ, nome e cargo', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => (init?.method === 'POST' ? resposta(200, { ok: true, decisao: 'aceita' }) : resposta(200, RESUMO)));
    vi.stubGlobal('fetch', fetchMock);
    renderPagina();

    expect(await screen.findByText('Confirme esta duplicata')).toBeInTheDocument();
    expect(screen.getByText('R$ 100.000')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Confirmo' }));
    await userEvent.type(screen.getByRole('textbox', { name: /CNPJ da sua empresa/ }), '11.222.333/0001-81');
    await userEvent.type(screen.getByRole('textbox', { name: 'Seu nome' }), 'Ana Souza');
    await userEvent.type(screen.getByRole('textbox', { name: 'Seu cargo' }), 'Financeiro');
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar a duplicata' }));

    expect(await screen.findByText('Duplicata confirmada')).toBeInTheDocument();
    const post = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'POST')!;
    expect(String(post[0])).toContain('/public/aceite/tok123');
    expect(JSON.parse(String((post[1] as RequestInit).body))).toMatchObject({ decisao: 'aceita', cnpj: '11.222.333/0001-81', nome: 'Ana Souza', cargo: 'Financeiro' });
  });

  it('contestar pede o motivo', async () => {
    vi.stubGlobal('fetch', vi.fn(() => resposta(200, RESUMO)));
    renderPagina();
    await userEvent.click(await screen.findByRole('button', { name: 'Contesto' }));
    expect(screen.getByRole('textbox', { name: 'O que está errado?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enviar contestação' })).toBeInTheDocument();
  });

  it('link já usado mostra a mensagem do servidor, sem formulário', async () => {
    vi.stubGlobal('fetch', vi.fn(() => resposta(410, { error: 'ja_respondido', message: 'Esta duplicata já foi respondida — obrigado.' })));
    renderPagina();
    await waitFor(() => expect(screen.getByText('Link indisponível')).toBeInTheDocument());
    expect(screen.getByText('Esta duplicata já foi respondida — obrigado.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirmo' })).not.toBeInTheDocument();
  });
});
