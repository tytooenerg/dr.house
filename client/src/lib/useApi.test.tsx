import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useApi } from './useApi';
import { api, ApiError } from './api';

// O valor destes testes está no primeiro: ele reproduz a corrida real que existia em
// AutomacaoPage.tsx (poll de 4s + mutações via POST) e falha sem o sequenciamento do hook.
beforeEach(() => {
  vi.restoreAllMocks();
});

describe('useApi', () => {
  it('carrega o payload e expõe data', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ n: 1 });
    const { result } = renderHook(() => useApi<{ n: number }>('/x'));
    await waitFor(() => expect(result.current.data).toEqual({ n: 1 }));
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('resposta ATRASADA de uma carga antiga não sobrescreve a mais recente', async () => {
    // Reproduz o bug: o GET do poll sai primeiro e volta por último. Sem o controle de
    // sequência, o `{ valor: 'antigo' }' venceria por chegar depois — que era exatamente o
    // campo revertendo sozinho na tela do investidor.
    let resolvePrimeira!: (v: { valor: string }) => void;
    let resolveSegunda!: (v: { valor: string }) => void;
    const primeira = new Promise<{ valor: string }>((r) => (resolvePrimeira = r));
    const segunda = new Promise<{ valor: string }>((r) => (resolveSegunda = r));
    const get = vi.spyOn(api, 'get').mockImplementationOnce(() => primeira).mockImplementationOnce(() => segunda);

    const { result } = renderHook(() => useApi<{ valor: string }>('/x'));
    await act(async () => {
      void result.current.reload(); // segunda carga, ainda com a primeira em voo
    });

    await act(async () => {
      resolveSegunda({ valor: 'novo' });
      await Promise.resolve();
    });
    await act(async () => {
      resolvePrimeira({ valor: 'antigo' }); // chega DEPOIS
      await Promise.resolve();
    });

    expect(get).toHaveBeenCalledTimes(2);
    expect(result.current.data).toEqual({ valor: 'novo' });
  });

  it('setData de uma mutação não é desfeito por um GET que ainda estava em voo', async () => {
    let resolveGet!: (v: { taxa: string }) => void;
    const pendente = new Promise<{ taxa: string }>((r) => (resolveGet = r));
    vi.spyOn(api, 'get').mockImplementation(() => pendente);

    const { result } = renderHook(() => useApi<{ taxa: string }>('/automacao'));
    await act(async () => {
      result.current.setData({ taxa: '3,5' }); // o POST respondeu primeiro
      await Promise.resolve();
    });
    await act(async () => {
      resolveGet({ taxa: '2,0' }); // resposta velha do poll
      await Promise.resolve();
    });

    expect(result.current.data).toEqual({ taxa: '3,5' });
  });

  it('erro da API vira a mensagem da própria API; erro sem mensagem cai no texto padrão', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new ApiError(403, 'Plano Pro necessário', null));
    const { result } = renderHook(() => useApi('/x'));
    await waitFor(() => expect(result.current.error).toBe('Plano Pro necessário'));

    vi.spyOn(api, 'get').mockRejectedValue(new Error('boom'));
    const { result: r2 } = renderHook(() => useApi('/y', { fallbackMessage: 'Falha ao carregar X.' }));
    await waitFor(() => expect(r2.current.error).toBe('Falha ao carregar X.'));
  });

  it('keepDataOnError: falha depois da primeira carga não derruba a tela que já funcionava', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({ n: 1 });
    const { result } = renderHook(() => useApi<{ n: number }>('/x', { keepDataOnError: true }));
    await waitFor(() => expect(result.current.data).toEqual({ n: 1 }));

    get.mockRejectedValue(new ApiError(500, 'servidor caiu', null));
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.error).toBeNull();
    expect(result.current.data).toEqual({ n: 1 });
  });

  it('enabled: false não busca nada', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({ n: 1 });
    const { result } = renderHook(() => useApi('/x', { enabled: false }));
    expect(get).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
  });

  it('não escreve estado depois do desmonte', async () => {
    let resolveGet!: (v: { n: number }) => void;
    const pendente = new Promise<{ n: number }>((r) => (resolveGet = r));
    vi.spyOn(api, 'get').mockImplementation(() => pendente);
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { unmount } = renderHook(() => useApi('/x'));
    unmount();
    await act(async () => {
      resolveGet({ n: 1 });
      await Promise.resolve();
    });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
