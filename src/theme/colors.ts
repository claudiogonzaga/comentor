// Paleta de vaso grego — figura negra sobre terracota. O fundo (claro de dia,
// escuro à noite) é aplicado em VaseBackground; aqui ficam os tons fixos.
import { ESPACIAL } from './tema';

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

