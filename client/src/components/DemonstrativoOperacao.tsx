import { useEffect, useState } from 'react';
import { api } from '../lib/api';

// "Quem paga quanto e quem recebe quanto" — a conta de uma operação em reais, do valor da
// duplicata até o que cai no saldo de cada lado. Os números e rótulos vêm prontos do servidor
// (server/src/lib/demonstrativo.ts), calculados pelas mesmas funções que movem o dinheiro na
// liquidação; esta tela só desenha.

export interface LinhaDemonstrativo {
  rotulo: string;
  detalhe: string | null;
  valorFmt: string;
  tipo: 'base' | 'menos' | 'total' | 'resultado';
}

export interface Demonstrativo {
  linhas: LinhaDemonstrativo[];
  rodape: string;
  valorFace: number;
  compradorPaga: number;
  taxaPlataforma: number;
  vendedorRecebe: number;
  ganhoComprador: number;
  /** Só na oferta do leilão: em qual taxa a conta foi feita (melhor lance ou reserva). */
  referencia?: string;
}

const SINAL: Record<LinhaDemonstrativo['tipo'], string> = { base: '', menos: '−', total: '=', resultado: '=' };

export function DemonstrativoOperacao({ demonstrativo, titulo, carregando = false }: { demonstrativo: Demonstrativo; titulo: string; carregando?: boolean }) {
  return (
    <div className={`bg-white border border-border rounded-lg px-3.5 py-3 transition-opacity ${carregando ? 'opacity-60' : ''}`} data-testid="demonstrativo">
      <div className="text-[11.5px] font-bold text-textSecondary uppercase tracking-wide mb-2">{titulo}</div>
      <div className="flex flex-col">
        {demonstrativo.linhas.map((l) => {
          const destaque = l.tipo === 'total' || l.tipo === 'resultado';
          return (
            <div
              key={l.rotulo}
              className={`flex items-start justify-between gap-3 py-1.5 text-[13px] ${destaque ? 'border-t border-border' : ''} ${l.tipo === 'resultado' ? 'bg-greenBg -mx-3.5 px-3.5 rounded-b-md' : ''}`}
            >
              <div className="min-w-0">
                <span className="inline-block w-3.5 text-textTertiary font-bold">{SINAL[l.tipo]}</span>
                <span className={destaque ? 'font-bold text-navy' : 'text-textSecondary'}>{l.rotulo}</span>
                {l.detalhe && <div className="pl-3.5 text-[11.5px] text-textTertiary">{l.detalhe}</div>}
              </div>
              <span className={`font-mono-num whitespace-nowrap ${l.tipo === 'resultado' ? 'font-extrabold text-green' : destaque ? 'font-bold text-navy' : l.tipo === 'menos' ? 'text-red' : 'text-navy'}`}>
                {l.valorFmt}
              </span>
            </div>
          );
        })}
      </div>
      <div className="text-[11.5px] text-textSecondary mt-2">{demonstrativo.rodape}</div>
    </div>
  );
}

/**
 * Pede ao servidor a conta para o valor que a pessoa está digitando (taxa do lance, preço do
 * anúncio), esperando ela parar de digitar. `path` null = nada digitado ainda. Em caso de
 * erro (valor inválido enquanto digita), devolve null e quem chama mostra o demonstrativo
 * de referência.
 */
export function useDemonstrativoSimulado(path: string | null, esperaMs = 300): { demonstrativo: Demonstrativo | null; carregando: boolean } {
  const [demonstrativo, setDemonstrativo] = useState<Demonstrativo | null>(null);
  const [carregando, setCarregando] = useState(false);
  useEffect(() => {
    if (!path) {
      setDemonstrativo(null);
      setCarregando(false);
      return;
    }
    let cancelado = false;
    setCarregando(true);
    const t = setTimeout(() => {
      api
        .get<Demonstrativo>(path)
        .then((d) => {
          if (!cancelado) setDemonstrativo(d);
        })
        .catch(() => {
          if (!cancelado) setDemonstrativo(null);
        })
        .finally(() => {
          if (!cancelado) setCarregando(false);
        });
    }, esperaMs);
    return () => {
      cancelado = true;
      clearTimeout(t);
    };
  }, [path, esperaMs]);
  return { demonstrativo, carregando };
}
