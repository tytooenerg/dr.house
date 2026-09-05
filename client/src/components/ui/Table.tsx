import type { ReactNode } from 'react';

// Table/TableHead/TableRow existiam dentro de Modal.tsx (colocação estranha) e tinham ZERO
// usos — código morto desde sempre, enquanto as 6 tabelas de dados do app repetiam a mesma
// marcação à mão. Aqui elas saem do limbo e ganham o que faltava: papéis ARIA.
//
// Por que ARIA e não <table> semântica: as colunas são dimensionadas com `gridTemplateColumns`
// fracionário ('1.3fr 0.9fr 0.8fr…'), que não tem equivalente direto em layout de tabela.
// Preservar o visual exigiria `display: grid` na <table> com `display: contents` nas linhas —
// e `display: contents` REMOVE justamente a semântica de tabela em vários leitores de tela,
// anulando o ganho. Com os papéis ARIA sobre a grade atual, o leitor anuncia "tabela", navega
// por células e lê o cabeçalho junto com o valor ("Vencimento: 22/09/2026"), sem risco visual.
export function Table({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div role="table" aria-label={label} className="bg-white border border-border rounded-card overflow-hidden">
      {children}
    </div>
  );
}

export function TableHead({ columns, labels }: { columns: string; labels: string[] }) {
  return (
    <div role="rowgroup">
      <div
        role="row"
        className="grid gap-3 px-5 py-3.5 bg-surface border-b border-border text-xs font-bold text-textSecondary uppercase tracking-wide"
        style={{ gridTemplateColumns: columns }}
      >
        {labels.map((l) => (
          <div role="columnheader" key={l}>
            {l}
          </div>
        ))}
      </div>
    </div>
  );
}

// Corpo da tabela: envolve as linhas para o leitor de tela saber onde o cabeçalho acaba.
export function TableBody({ children }: { children: ReactNode }) {
  return <div role="rowgroup">{children}</div>;
}

export function TableRow({ columns, className = '', children }: { columns: string; className?: string; children: ReactNode }) {
  return (
    <div
      role="row"
      className={`grid gap-3 px-5 py-4 border-b border-border last:border-b-0 items-center text-sm ${className}`}
      style={{ gridTemplateColumns: columns }}
    >
      {children}
    </div>
  );
}

export function TableCell({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return (
    <div role="cell" className={className}>
      {children}
    </div>
  );
}
