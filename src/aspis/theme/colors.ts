// Paleta do Aspis — vaso grego, figura negra sobre terracota (mesma identidade
// do CoMentor). O fundo terracota é aplicado em VaseBackground; aqui ficam os
// tons fixos. A ação primária (`accent.gold`) é o preto da figura negra; o
// texto sobre ela (`text.onGold`) é creme.
export const colors = {
  bg: {
    primary: '#C8703F',
    gradientEnd: '#B05A30',
    surface: 'rgba(42,26,16,0.16)',
    surfaceStrong: 'rgba(42,26,16,0.26)',
    overlay: 'rgba(28,15,8,0.62)',
  },
  accent: {
    gold: '#2A1A10', // ação primária = preto (figura negra)
    goldDim: '#6B4528',
    lavender: '#7C4A2C',
    success: '#5E7C46', // verde-oliva (louro)
    warning: '#B5611E',
    danger: '#9E3327', // vermelho de cerâmica
  },
  text: {
    primary: '#2A1A10',
    secondary: 'rgba(42,26,16,0.62)',
    tertiary: 'rgba(42,26,16,0.40)',
    onGold: '#F2DCC0', // texto creme sobre o botão preto
  },
  border: 'rgba(42,26,16,0.28)',
  star: 'rgba(42,26,16,0.50)',
} as const;

// Espectro de alinhamento — escala Likert de 5 níveis (0–4): 0=vermelho (pior)
// → 4=azul (melhor), com o centro (2) âmbar. Tons em cerâmica para contraste
// sobre o fundo terracota.
export const ALIGN_LEVELS = 5; // 0..4
export const ALIGN_MAX = ALIGN_LEVELS - 1; // 4
export const ALIGN_MID = (ALIGN_LEVELS - 1) / 2; // 2 = 50%

export const ALIGN_COLORS = [
  '#9E3327', // 0 mínimo
  '#B5611E', // 1 baixo
  '#A8862A', // 2 médio (centro)
  '#5E7C46', // 3 alto
  '#3A6E8C', // 4 máximo
] as const;

export const ALIGN_LABELS = ['mínimo', 'baixo', 'médio', 'alto', 'máximo'] as const;

export function alignColor(level: number): string {
  return ALIGN_COLORS[Math.max(0, Math.min(ALIGN_MAX, Math.round(level)))];
}

// Cores dos pills de pilar — tons de terra/cerâmica, coerentes com o vaso.
export const PILLAR_PALETTE = [
  '#7C4A2C', // sépia
  '#5E7C46', // oliva
  '#B5611E', // ocre
  '#9E3327', // vermelho cerâmica
  '#6B4528', // marrom
  '#8A6D3B', // mostarda
] as const;

export function pillarColor(index: number): string {
  return PILLAR_PALETTE[index % PILLAR_PALETTE.length];
}
