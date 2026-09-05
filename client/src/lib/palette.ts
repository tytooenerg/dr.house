// Fonte única das cores da interface.
//
// Antes disto havia 556 literais hex espalhados por 63 arquivos, em 58 tons distintos — e a
// maioria já era um token do Tailwind reescrito à mão ('#0A5C36' 51 vezes é o `green`,
// '#1E5EFF' 42 vezes é o `blue`). Pior, alguns papéis tinham DOIS tons concorrentes: dois
// vermelhos de erro (#B3261E e #B03A2E) e dois âmbares de alerta (#8A5A00 e #B8790A),
// chegando a aparecer no mesmo arquivo (admin/KybPanel.tsx) — a mesma ideia pintada de duas
// cores diferentes lado a lado.
//
// Toda cor vive aqui e no tailwind.config.js, com o MESMO nome nos dois lugares:
//   - em `className`, use o token do Tailwind: `text-green`, `bg-surface`, `border-navyBorder`
//   - em valor de JS (style inline, props de Badge/Donut, mapas de status), use `PALETTE.green`
//
// Se precisar de uma cor nova, adicione nos dois lugares em vez de escrever o hex no
// componente — é o que impede a volta dos 58 tons.
export const PALETTE = {
  // Marca
  blue: '#1E5EFF',
  blueSoft: '#C7D6FF',
  navy: '#0B1F3A',
  chip: '#EEF3FF',

  // Sobre fundo navy (sidebar, cards de destaque, landing)
  onNavy: '#9FB3D6',
  onNavyBright: '#4C8CFF',
  onNavyDim: '#B8C2D4',
  onNavyFaint: '#7C8BA6',
  navyBorder: '#2A3F5F',
  // Verde e vermelho legíveis SOBRE navy — os `green`/`red` abaixo são escuros demais nesse fundo.
  greenOnNavy: '#6FCF97',
  redOnNavy: '#FF9E9E',

  // Superfícies e traços
  bg: '#F5F7FA',
  surface: '#F7F8FA',
  border: '#E4E8EE',
  hairline: '#F0F2F5',
  inputBorder: '#D6DCE5',
  borderStrong: '#C7D0DE',

  // Texto
  textPrimary: '#0B1F3A',
  slate: '#3D4658',
  textSecondary: '#5B6472',
  textTertiary: '#8B97AC',
  textMuted: '#9AA5B5',

  // Semântica de estado
  green: '#0A5C36',
  greenBg: '#EAF3EE',
  amber: '#B8790A',
  amberBg: '#FBF1E0',
  amberMid: '#F1C889',
  red: '#B03A2E',
  redBg: '#F7E9E7',
  redBorder: '#E9CFCB',
  greenBorder: '#CFE6D9',
} as const;

export type PaletteColor = keyof typeof PALETTE;

// Cores CATEGÓRICAS de setor do sacado. Deliberadamente fora do PALETTE semântico acima:
// um setor não é um estado — "indústria" não significa alerta e "serviços" não significa
// sucesso. Reaproveitar amber/red/green aqui faria um setor herdar a cor de um estado e
// mudar de significado junto com ele.
export const SECTOR_COLORS: Record<string, { bg: string; color: string }> = {
  varejo: { bg: '#E8EEFB', color: '#2952A3' },
  atacado: { bg: '#F0EAFB', color: '#6B3FA0' },
  comercio: { bg: '#FCEAF5', color: '#A33578' },
  industria: { bg: '#FBF1E0', color: '#8A5A00' },
  construcao: { bg: '#F7E9E7', color: '#B3261E' },
  servicos: { bg: '#EAF3EE', color: '#0A5C36' },
};
