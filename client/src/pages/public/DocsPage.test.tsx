import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../../lib/i18n';
import { DocsPage } from './DocsPage';

const FAKE_SPEC = {
  openapi: '3.0.3',
  info: { title: 'Lastro Partner API', version: '1.0.0', description: 'API pública de teste.' },
  paths: {
    '/duplicatas': {
      post: {
        summary: 'Emitir uma duplicata escriturada (somente contas cedente)',
        parameters: [],
        requestBody: {
          content: {
            'application/json': {
              schema: { required: ['sacado', 'valor'], properties: { sacado: { type: 'string', example: 'Grupo Atlas Varejo' }, valor: { type: 'string', example: '84.500,00' } } },
            },
          },
        },
        responses: { '200': { description: 'Duplicata registrada com sucesso.' }, '400': { description: 'Erro de validação.' } },
      },
    },
    '/sacados/{cnpj}/score': {
      get: {
        summary: 'Consultar score de crédito e rating de um sacado pelo CNPJ',
        parameters: [{ name: 'cnpj', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Score, rating e fatores.' } },
      },
    },
  },
};

function renderDocsPage() {
  return render(
    <MemoryRouter>
      <LanguageProvider>
        <DocsPage />
      </LanguageProvider>
    </MemoryRouter>
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DocsPage — real public developer documentation', () => {
  it('renders the code sample tabs and the rate-limit table without needing the network', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})) // never resolves — page still renders its static content
    );
    renderDocsPage();
    expect(screen.getByText('Documentação da Lastro Partner API')).toBeInTheDocument();
    expect(screen.getByText('cURL')).toBeInTheDocument();
    expect(screen.getByText('Node.js')).toBeInTheDocument();
    expect(screen.getByText('Python')).toBeInTheDocument();
    expect(screen.getByText('150/min')).toBeInTheDocument(); // Pro plan tier
    expect(screen.getByText('400/min')).toBeInTheDocument(); // Empresarial plan tier
  });

  it('fetches the real live OpenAPI spec and renders each endpoint from it, not a static copy', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ json: () => Promise.resolve(FAKE_SPEC) } as Response))
    );
    renderDocsPage();

    await waitFor(() => expect(screen.getByText(/2 rotas documentadas/)).toBeInTheDocument());
    expect(screen.getByText('/v1/duplicatas')).toBeInTheDocument();
    expect(screen.getByText('Emitir uma duplicata escriturada (somente contas cedente)')).toBeInTheDocument();
    expect(screen.getByText('/v1/sacados/{cnpj}/score')).toBeInTheDocument();
    // "Grupo Atlas Varejo" appears both in the static getting-started sample and in the
    // dynamically-rendered requestBody example built from the live spec's own schema.
    expect(screen.getAllByText(/Grupo Atlas Varejo/).length).toBeGreaterThanOrEqual(2);
  });

  it('switches between curl/Node/Python code samples on click', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {}))
    );
    const user = userEvent.setup();
    renderDocsPage();
    expect(screen.getByText(/curl -X POST/)).toBeInTheDocument();
    await user.click(screen.getByText('Node.js'));
    expect(screen.getByText(/LastroClient/)).toBeInTheDocument();
    await user.click(screen.getByText('Python'));
    expect(screen.getByText(/lastro_sdk/)).toBeInTheDocument();
  });

  it('shows an honest error message instead of crashing when the spec fails to load', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('network down')))
    );
    renderDocsPage();
    await waitFor(() => expect(screen.getByText(/Não foi possível carregar a especificação/)).toBeInTheDocument());
  });
});
