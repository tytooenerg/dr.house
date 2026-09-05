import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api';

// O mesmo bloco de carga estava copiado em 44 arquivos: um `load()` que chama `api.get`,
// guarda o payload num useState e escreve `loadError` no catch. Além da repetição, essa cópia
// carregava dois defeitos que nenhuma delas tratava:
//
// 1. RESPOSTA FORA DE ORDEM sobrescrevendo dado mais novo. AutomacaoPage.tsx faz poll a cada
//    4s e, a cada mutação, um `api.post(...).then(setData)`. Se o GET do poll já estava em voo
//    quando o investidor editou um campo, a resposta ANTIGA do GET chegava depois da resposta
//    do POST e sobrescrevia o valor recém-salvo — o campo revertia sozinho na tela. O
//    `clearInterval` do cleanup só impede novos agendamentos; não cancela o que já saiu.
// 2. ESCRITA APÓS O DESMONTE: 27 dos 44 faziam `useEffect(() => { load(); }, [])` sem nenhuma
//    flag de cancelamento, então sair da página não impedia a resposta de escrever estado.
//
// A correção dos dois é a mesma ideia: numerar as cargas e deixar apenas a MAIS RECENTE
// escrever. `seq` só cresce; toda escrita confere se ainda é a corrente antes de aplicar.
//
// Sem cache de propósito: esta plataforma mostra oferta de marketplace, saldo e posição em
// aberto: servir dado guardado por padrão faria o investidor decidir sobre número velho. Cache
// é decisão de produto por rota, não efeito colateral de refatoração.
export interface UseApiResult<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => Promise<void>;
  /** Aplica um payload vindo de uma mutação (`api.post(...).then(setData)`), respeitando a
   *  mesma ordem: a escrita conta como a carga mais recente, então uma resposta de GET que
   *  ainda estava em voo não a desfaz. */
  setData: (value: T) => void;
}

export interface UseApiOptions {
  /** Mensagem mostrada quando o erro não vem da API com texto próprio. */
  fallbackMessage?: string;
  /** `false` adia a carga (rota que depende de algo ainda indefinido). */
  enabled?: boolean;
  /** Falha depois da primeira carga bem-sucedida não derruba a tela — usado por quem faz
   *  poll, onde uma falha isolada deve apenas esperar o próximo ciclo. */
  keepDataOnError?: boolean;
}

export function useApi<T>(path: string, options: UseApiOptions = {}): UseApiResult<T> {
  const { fallbackMessage = 'Falha ao carregar os dados.', enabled = true, keepDataOnError = false } = options;
  const [data, setDataState] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);

  const seq = useRef(0);
  const alive = useRef(true);
  const loadedOnce = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const setData = useCallback((value: T) => {
    seq.current += 1;
    if (!alive.current) return;
    loadedOnce.current = true;
    setDataState(value);
    setError(null);
  }, []);

  const reload = useCallback(async () => {
    const mine = ++seq.current;
    setError(null);
    setLoading(true);
    try {
      const result = await api.get<T>(path);
      if (!alive.current || mine !== seq.current) return;
      loadedOnce.current = true;
      setDataState(result);
    } catch (err) {
      if (!alive.current || mine !== seq.current) return;
      if (keepDataOnError && loadedOnce.current) return;
      setError(err instanceof ApiError ? err.message : fallbackMessage);
    } finally {
      if (alive.current && mine === seq.current) setLoading(false);
    }
  }, [path, fallbackMessage, keepDataOnError]);

  useEffect(() => {
    if (!enabled) return;
    void reload();
  }, [enabled, reload]);

  return { data, error, loading, reload, setData };
}
