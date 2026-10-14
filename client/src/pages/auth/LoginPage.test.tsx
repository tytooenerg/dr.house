import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SessionProvider } from '../../state/SessionContext';
import { LoginPage } from './LoginPage';

// Regressão: um hook novo (consulta do CNPJ) entrou depois do `if (loading) return null` e o
// React derrubava a página inteira na segunda renderização (erro #310) — ninguém conseguia
// nem fazer login. Este teste só precisa montar a tela e chegar ao cadastro da empresa.

function resposta(body: unknown, status = 200) {
  return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) } as Response);
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('LoginPage', () => {
  it('monta, abre o cadastro e pede o CNPJ da empresa, liberando o botão só com CNPJ válido', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        const u = String(url);
        if (u.includes('/public/cnpj/11444777000161')) return resposta({ valido: true, consultaReal: false, razaoSocial: null, situacao: null, ativo: null });
        if (u.includes('/public/cnpj/')) return resposta({ valido: false, consultaReal: false, razaoSocial: null, situacao: null, ativo: null });
        return resposta({});
      })
    );
    render(
      <MemoryRouter initialEntries={['/login']}>
        <SessionProvider>
          <LoginPage />
        </SessionProvider>
      </MemoryRouter>
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Criar conta' }));
    await userEvent.click(screen.getByText('Empresa (cedente)'));
    const cnpj = screen.getByRole('textbox', { name: 'CNPJ da empresa' });
    await userEvent.type(screen.getByPlaceholderText('Marina Costa'), 'Joana Prado');
    await userEvent.type(screen.getByPlaceholderText('Sua empresa Ltda'), 'Padaria Joana Ltda');
    await userEvent.type(screen.getByPlaceholderText('voce@empresa.com.br'), 'joana@padaria.com.br');
    await userEvent.type(screen.getByPlaceholderText('mínimo 6 caracteres'), 'senha123');
    const botao = screen.getByRole('button', { name: 'Criar conta e entrar' });

    await userEvent.type(cnpj, '11.111.111/1111-11');
    expect(await screen.findByText('CNPJ inválido — confira os números.')).toBeInTheDocument();
    expect(botao).toBeDisabled();

    await userEvent.clear(cnpj);
    await userEvent.type(cnpj, '11.444.777/0001-61');
    expect(await screen.findByText(/CNPJ válido/)).toBeInTheDocument();
    expect(botao).toBeEnabled();
  });
});
