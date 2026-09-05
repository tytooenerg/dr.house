import type { ReactNode } from 'react';
import { PALETTE } from '../../lib/palette';
import type { BadgeVariant } from './Badge';

// Irmã do Badge para o outro padrão que se repetia sozinho pelo app: 35 caixas de aviso
// (o retângulo colorido que explica um estado — "credenciamento em análise", "modo simulado",
// "nenhum PSP configurado"), usando exatamente os mesmos 5 pares de cores das pílulas, mas em
// 10 formas diferentes e sem componente nenhum.
//
// Mesma nomenclatura de `variant` do Badge de propósito: quem já sabe que uma pílula de erro é
// `variant="danger"` não precisa aprender outro vocabulário para a caixa de erro.
const VARIANT: Record<BadgeVariant, { bg: string; color: string }> = {
  success: { bg: PALETTE.greenBg, color: PALETTE.green },
  danger: { bg: PALETTE.redBg, color: PALETTE.red },
  warning: { bg: PALETTE.amberBg, color: PALETTE.amber },
  info: { bg: PALETTE.chip, color: PALETTE.blue },
  neutral: { bg: PALETTE.hairline, color: PALETTE.textSecondary },
};

export function Notice({
  variant = 'neutral',
  children,
  className = '',
}: {
  variant?: BadgeVariant;
  children: ReactNode;
  className?: string;
}) {
  const v = VARIANT[variant];
  return (
    <div className={`px-3.5 py-3 rounded-lg text-[12.5px] font-semibold ${className}`} style={{ background: v.bg, color: v.color }}>
      {children}
    </div>
  );
}
