import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../../lib/i18n';
import { ErpPage } from './ErpPage';

// O domínio próprio do white-label existia INTEIRO no servidor — POST /erp/whitelabel/domain
// com gate de plano, pré-requisito de marca e checagem de unicidade, POST .../remove, e o
// /public/brand resolvendo a marca por domínio antes de qualquer autenticação — e a tela não
// tinha UI nenhuma pra ele. O servidor servia `whitelabelCustomDomain` e ninguém no client o
// lia; foi o primeiro achado da trava de contrato (server/test/contrato-payload-tela.test.ts).
//
// A trava garante que o campo é MENCIONADO na página. Só um teste de página garante que ele
// vira tela e que os botões chamam as rotas certas — é isso que mora aqui.

const BASE = {
  connectors: [],
  whitelabelOn: true,
  whitelabelBrand: { nome: 'Fornecedor Lima', corPrimaria: '#123456', logoUrl: '' },
  whitelabelPlusEnabled: false,
  whitelabelPlusPriceFmt: 'R$ 490',
  whitelabelCustomDomain: null as string | null,
  omieConnected: false,
  sapConnected: false,
  totvsConnected: false,
  autoEmitEnabled: false,
  autoEmitMaxValor: '',
  hasErpConnected: false,
  companyCnpj: '',
};

function renderErp() {
  return render(
    <MemoryRouter>
      <LanguageProvider>
        <ErpPage />
      </LanguageProvider>
    </MemoryRouter>
  );
}

/** Responde a qualquer GET com `dados`; guarda os POSTs pra o teste conferir. */
function stubApi(dados: unknown, respostaDoPost: unknown = dados) {
  const posts: { url: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts.push({ url, body: init.body ? JSON.parse(String(init.body)) : null });
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(respostaDoPost) } as Response);
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(dados) } as Response);
    })
  );
  return posts;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ErpPage — domínio próprio do white-label', () => {
  it('sem domínio vinculado, oferece o formulário — e só habilita o botão quando há o que enviar', async () => {
    stubApi(BASE);
    renderErp();

    await waitFor(() => expect(screen.getByText('Domínio próprio')).toBeInTheDocument());
    const enviar = screen.getByRole('button', { name: 'Vincular domínio' });
    expect(enviar).toBeDisabled();

    await userEvent.type(screen.getByLabelText('Domínio próprio'), 'antecipa.fornecedorlima.com.br');
    expect(enviar).toBeEnabled();
  });

  it('vincular chama a rota real com o domínio digitado', async () => {
    const posts = stubApi(BASE, { ...BASE, whitelabelCustomDomain: 'antecipa.fornecedorlima.com.br' });
    renderErp();

    await waitFor(() => expect(screen.getByText('Domínio próprio')).toBeInTheDocument());
    await userEvent.type(screen.getByLabelText('Domínio próprio'), 'antecipa.fornecedorlima.com.br');
    await userEvent.click(screen.getByRole('button', { name: 'Vincular domínio' }));

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].url).toContain('/erp/whitelabel/domain');
    expect(posts[0].body).toEqual({ domain: 'antecipa.fornecedorlima.com.br' });
    // A resposta do POST substitui o estado: o domínio recém-vinculado aparece na hora.
    await waitFor(() => expect(screen.getByText('antecipa.fornecedorlima.com.br')).toBeInTheDocument());
  });

  it('com domínio vinculado, mostra qual é e troca o formulário por remover', async () => {
    const posts = stubApi({ ...BASE, whitelabelCustomDomain: 'pague.atlasvarejo.com.br' }, { ...BASE, whitelabelCustomDomain: null });
    renderErp();

    await waitFor(() => expect(screen.getByText('pague.atlasvarejo.com.br')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Vincular domínio' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Remover domínio próprio' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].url).toContain('/erp/whitelabel/domain/remove');
    // Removido, o formulário volta.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Vincular domínio' })).toBeInTheDocument());
  });

  it('sem marca configurada, a seção não aparece — o servidor recusaria com brand_required', async () => {
    stubApi({ ...BASE, whitelabelBrand: null });
    renderErp();

    await waitFor(() => expect(screen.getByText('Integrações ERP')).toBeInTheDocument());
    expect(screen.queryByText('Domínio próprio')).not.toBeInTheDocument();
  });

  it('erro do servidor aparece na tela em vez de sumir em silêncio', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          return Promise.resolve({
            ok: false,
            status: 409,
            json: () => Promise.resolve({ error: 'domain_taken', message: 'Este domínio já está vinculado a outra conta.' }),
          } as Response);
        }
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(BASE) } as Response);
      })
    );
    renderErp();

    await waitFor(() => expect(screen.getByText('Domínio próprio')).toBeInTheDocument());
    await userEvent.type(screen.getByLabelText('Domínio próprio'), 'ja.existe.com.br');
    await userEvent.click(screen.getByRole('button', { name: 'Vincular domínio' }));

    // A mensagem do servidor, não uma genérica: quem tenta vincular precisa saber que o
    // domínio é de outra conta, e não que "algo deu errado".
    await waitFor(() => expect(screen.getByText('Este domínio já está vinculado a outra conta.')).toBeInTheDocument());
  });
});
