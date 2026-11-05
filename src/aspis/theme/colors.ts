// Paleta do Aspis — vaso grego, figura negra sobre terracota (mesma identidade
// do CoMentor). O fundo terracota é aplicado em VaseBackground; aqui ficam os
// tons fixos. A ação primária (`accent.gold`) é o preto da figura negra; o
// texto sobre ela (`text.onGold`) é creme.
import { ESPACIAL } from '../../theme/tema';
const TERRACOTA = {
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

export const colors = ESPACIAL
  ? ({
      bg: {
        primary: '#090C16',
        gradientEnd: '#131A33',
        surface: 'rgba(241,239,232,0.06)',
        surfaceStrong: 'rgba(241,239,232,0.11)',
        overlay: 'rgba(5,7,14,0.72)',
      },
      accent: {
        gold: '#FAEEDA', // ação primária = o astro (creme)
        goldDim: '#B4B2A9',
        lavender: '#6B7AA8',
        success: '#97C459',
        warning: '#EF9F27',
        danger: '#E24B4A',
      },
      text: {
        primary: '#F1EFE8',
        secondary: 'rgba(241,239,232,0.68)',
        tertiary: 'rgba(241,239,232,0.42)',
        onGold: '#2C2C2A', // texto escuro sobre o botão creme
      },
      border: 'rgba(107,122,168,0.38)',
      star: 'rgba(250,238,218,0.60)',
    } as const)
  : TERRACOTA;


// Alinhamento: escala Likert de 5 níveis (0–4), em figura negra (ver StarsRuler).
export const ALIGN_LEVELS = 5; // 0..4
export const ALIGN_MAX = ALIGN_LEVELS - 1; // 4
export const ALIGN_MID = (ALIGN_LEVELS - 1) / 2; // 2 = 50%

export const ALIGN_LABELS = ['mínimo', 'baixo', 'médio', 'alto', 'máximo'] as const;

// Cores dos pills de pilar — tons de terra/cerâmica, coerentes com o vaso (no espacial,
// os tons claros do céu).
export const PILLAR_PALETTE = ESPACIAL
  ? ([
      '#B5D4F4', // azul de Netuno
      '#C0DD97', // verde
      '#EF9F27', // âmbar
      '#F4C0D1', // rosa
      '#CECBF6', // lavanda
      '#FAEEDA', // creme do astro
    ] as const)
  : ([
      '#7C4A2C', // sépia
      '#5E7C46', // oliva
      '#B5611E', // ocre
      '#9E3327', // vermelho cerâmica
      '#6B4528', // marrom
      '#8A6D3B', // mostarda
    ] as const);

export function pillarColor(index: number): string {
  return PILLAR_PALETTE[index % PILLAR_PALETTE.length];
}
