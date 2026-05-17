// Dois temas: claro (vaso grego — figura negra sobre terracota) e escuro
// (céu noturno índigo com estrelas — o visual original do app).
//
// A preferência do usuário ('light' | 'dark' | 'auto') fica no banco. Como as
// telas importam `colors` no carregamento do módulo, o tema é resolvido aqui
// de forma SÍNCRONA (leitura direta do SQLite) — assim toda a paleta já nasce
// certa. Trocar de tema regrava a preferência e recarrega o app.

import * as SQLite from 'expo-sqlite';

export type ThemeMode = 'light' | 'dark' | 'auto';

export interface ThemeColors {
  bg: {
    primary: string;
    gradientEnd: string;
    surface: string;
    surfaceStrong: string;
    overlay: string;
  };
  accent: {
    gold: string;
    goldDim: string;
    lavender: string;
    success: string;
    warning: string;
    danger: string;
  };
  text: {
    primary: string;
    secondary: string;
    tertiary: string;
    onGold: string;
  };
  border: string;
  star: string;
}

// Tema CLARO — vaso grego: figura negra sobre terracota.
const lightColors: ThemeColors = {
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
    success: '#5E7C46',
    warning: '#B5611E',
    danger: '#9E3327',
  },
  text: {
    primary: '#2A1A10',
    secondary: 'rgba(42,26,16,0.62)',
    tertiary: 'rgba(42,26,16,0.40)',
    onGold: '#F2DCC0',
  },
  border: 'rgba(42,26,16,0.28)',
  star: 'rgba(42,26,16,0.50)',
};

// Tema ESCURO — céu noturno índigo (o visual original do app).
const darkColors: ThemeColors = {
  bg: {
    primary: '#1B1F3B',
    gradientEnd: '#2D2B55',
    surface: 'rgba(255,255,255,0.10)',
    surfaceStrong: 'rgba(255,255,255,0.17)',
    overlay: 'rgba(0,0,0,0.55)',
  },
  accent: {
    gold: '#F4C553',
    goldDim: '#C99A3A',
    lavender: '#A78BFA',
    success: '#7DD3A8',
    warning: '#F59E5C',
    danger: '#E47878',
  },
  text: {
    primary: 'rgba(255,255,255,0.92)',
    secondary: 'rgba(255,255,255,0.58)',
    tertiary: 'rgba(255,255,255,0.38)',
    onGold: '#1B1F3B',
  },
  border: 'rgba(255,255,255,0.12)',
  star: 'rgba(255,255,255,0.6)',
};

/** Está de noite? Pôr do sol aproximado às 18h, nascer às 6h. */
export function isNightNow(): boolean {
  const h = new Date().getHours();
  return h >= 18 || h < 6;
}

/** Lê a preferência de tema do banco de forma síncrona, no carregamento. */
function resolveThemeMode(): ThemeMode {
  try {
    const db = SQLite.openDatabaseSync('comentor.db');
    const row = db.getFirstSync<{ theme_mode: string | null }>(
      'SELECT theme_mode FROM user_config WHERE id = 1',
    );
    db.closeSync();
    const m = row?.theme_mode;
    if (m === 'light' || m === 'dark' || m === 'auto') return m;
    return 'auto';
  } catch {
    // Banco/coluna ainda não existem (primeira execução) — usa automático.
    return 'auto';
  }
}

/** Preferência salva ('light' | 'dark' | 'auto'). */
export const themePreference: ThemeMode = resolveThemeMode();

/** Tema efetivamente em uso nesta sessão. */
export const activeTheme: 'light' | 'dark' =
  themePreference === 'light'
    ? 'light'
    : themePreference === 'dark'
      ? 'dark'
      : isNightNow()
        ? 'dark'
        : 'light';

export const colors: ThemeColors =
  activeTheme === 'dark' ? darkColors : lightColors;
