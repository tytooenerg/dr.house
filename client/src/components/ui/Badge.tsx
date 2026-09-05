import type { ReactNode } from 'react';
import { PALETTE } from '../../lib/palette';

// As pílulas de status estavam montadas à mão em 26 arquivos — 46 delas, em 11 formas
// ligeiramente diferentes (`px-2 py-0.5 rounded` aqui, `px-2.5 py-1 rounded-md` ali) e sempre
// repetindo um dos mesmos 5 pares de cores. `variant` nomeia o par (ninguém precisa lembrar
// que "aprovado" é greenBg/green) e `size` reduz as 11 formas a 3.
//
// O par `bg`/`color` continua aceito como escape para o caso legítimo que NÃO é semântico:
// as cores categóricas de setor (SECTOR_COLORS em lib/palette.ts) — setor é uma escala
// categórica, não um estado, como já documentado na PR de cores.
export type BadgeVariant = 'success' | 'danger' | 'warning' | 'info' | 'neutral';
export type BadgeSize = 'sm' | 'md' | 'lg';

const VARIANT: Record<BadgeVariant, { bg: string; color: string }> = {
  success: { bg: PALETTE.greenBg, color: PALETTE.green },
  danger: { bg: PALETTE.redBg, color: PALETTE.red },
  warning: { bg: PALETTE.amberBg, color: PALETTE.amber },
  info: { bg: PALETTE.chip, color: PALETTE.blue },
  neutral: { bg: PALETTE.hairline, color: PALETTE.textSecondary },
};

const SIZE: Record<BadgeSize, string> = {
  sm: 'text-[10.5px] px-1.5 py-0.5 rounded',
  md: 'text-[11.5px] px-2.5 py-1 rounded-md',
  lg: 'text-[11.5px] px-3 py-1.5 rounded-md',
};

export function Badge({
  label,
  children,
  variant,
  size = 'md',
  bg,
  color,
  className = '',
}: {
  label?: string;
  children?: ReactNode;
  variant?: BadgeVariant;
  size?: BadgeSize;
  bg?: string;
  color?: string;
  className?: string;
}) {
  const v = variant ? VARIANT[variant] : { bg: bg ?? PALETTE.hairline, color: color ?? PALETTE.textSecondary };
  return (
    <span className={`inline-flex items-center font-bold w-fit ${SIZE[size]} ${className}`} style={{ background: v.bg, color: v.color }}>
      {children ?? label}
    </span>
  );
}

export function Dot({ color, size = 7, className = '' }: { color: string; size?: number; className?: string }) {
  return <span className={`rounded-full flex-shrink-0 ${className}`} style={{ background: color, width: size, height: size }} />;
}

export function AiTag({ label = 'IA' }: { label?: string }) {
  return <span className="text-[10.5px] font-extrabold px-2 py-0.5 rounded-md bg-chip text-blue">{label}</span>;
}
