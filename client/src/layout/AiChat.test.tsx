import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AiChat } from './AiChat';

// O widget só mostrava botões de sugestão prontos (`suggestions.map(...)`) — não havia
// nenhum <input> pra o usuário digitar uma pergunta livre, mesmo o backend (POST /chat/ask)
// já aceitando qualquer texto. Estes testes travam a existência do campo livre.

function mockFetch(suggestions: string[], answer: string) {
  return vi.fn((_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ question: 'x', answer, source: 'llm' }) } as Response);
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ suggestions, llmEnabled: true }) } as Response);
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AiChat — campo de pergunta livre', () => {
  it('mostra um campo de texto e um botão de enviar quando o assistente é aberto', async () => {
    vi.stubGlobal('fetch', mockFetch(['O que é deságio?'], 'resposta'));
    render(<AiChat />);

    await userEvent.click(screen.getByRole('button', { name: /assistente de ia/i }));

    expect(screen.getByPlaceholderText(/digite sua pergunta/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /enviar/i })).toBeInTheDocument();
  });

  it('envia a pergunta digitada (não apenas as sugestões prontas) e mostra a resposta real', async () => {
    vi.stubGlobal('fetch', mockFetch(['O que é deságio?'], 'Resposta calculada pela IA real.'));
    render(<AiChat />);

    await userEvent.click(screen.getByRole('button', { name: /assistente de ia/i }));
    const input = screen.getByPlaceholderText(/digite sua pergunta/i);
    await userEvent.type(input, 'Qual duplicata rende mais anualizada?');
    await userEvent.click(screen.getByRole('button', { name: /enviar/i }));

    expect(screen.getByText('Qual duplicata rende mais anualizada?')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Resposta calculada pela IA real.')).toBeInTheDocument());
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('não envia uma pergunta em branco', async () => {
    const fetchMock = mockFetch(['O que é deságio?'], 'resposta');
    vi.stubGlobal('fetch', fetchMock);
    render(<AiChat />);

    await userEvent.click(screen.getByRole('button', { name: /assistente de ia/i }));
    expect(screen.getByRole('button', { name: /enviar/i })).toBeDisabled();
  });
});
