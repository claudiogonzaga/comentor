// A paleta do Kairós, tirada do tema da Noosfera: uma superfície calma (claro ou
// escuro) e UM acento para a ação — o roxo herdado do Graphé fica como acento discreto
// no terracota; no espacial é o creme do astro; no ecológico, o verde-musgo. Urgência,
// conclusão e nota usam pontos e traços de cor, sem blocos coloridos competindo.
//
// Só exibição: nada aqui muda o que as tarefas guardam (rules.ts).
import { TEMA } from '../theme/tema';

export interface Tema {
  escuro: boolean;
  bg: string;
  card: string;
  linha: string;
  txt: string;
  suave: string;
  /** A ação primária: chip ativo, +, concluir, salvar. */
  acento: string;
  sobreAcento: string;
  /** O acento bem diluído, para o fundo de um botão secundário. */
  acentoFundo: string;
  urg: string;
  ok: string;
  estrela: string;
}

const terracotaClaro: Tema = {
  escuro: false,
  bg: '#F6EFE7',
  card: '#FFFBF6',
  linha: 'rgba(42,26,16,0.10)',
  txt: '#2A1A10',
  suave: '#7A6656',
  acento: '#5B2C6F',
  sobreAcento: '#FFFFFF',
  acentoFundo: 'rgba(91,44,111,0.09)',
  urg: '#9E3327',
  ok: '#5E7C46',
  estrela: '#B5611E',
};

const terracotaEscuro: Tema = {
  escuro: true,
  bg: '#1C1410',
  card: '#271C16',
  linha: 'rgba(242,230,218,0.10)',
  txt: '#F2E6DA',
  suave: '#B8A595',
  acento: '#CDA9DC',
  sobreAcento: '#24122D',
  acentoFundo: 'rgba(205,169,220,0.13)',
  urg: '#E3826B',
  ok: '#9CBF7E',
  estrela: '#E0A458',
};

const espacial: Tema = {
  escuro: true,
  bg: '#0B0F1C',
  card: '#141A2E',
  linha: 'rgba(107,122,168,0.22)',
  txt: '#F1EFE8',
  suave: '#A7A9B4',
  acento: '#FAEEDA',
  sobreAcento: '#2C2C2A',
  acentoFundo: 'rgba(250,238,218,0.10)',
  urg: '#EC6B6A',
  ok: '#97C459',
  estrela: '#FAC775',
};

const ecologico: Tema = {
  escuro: false,
  bg: '#EEF2E6',
  card: '#F8FAF4',
  linha: 'rgba(31,51,38,0.10)',
  txt: '#1F3326',
  suave: '#5F6F63',
  acento: '#2F5D3A',
  sobreAcento: '#F1F5EC',
  acentoFundo: 'rgba(47,93,58,0.10)',
  urg: '#B5452F',
  ok: '#5E8C3A',
  estrela: '#C98A2B',
};

/**
 * O tema do Kairós nesta execução: o espacial é sempre escuro; o ecológico, sempre
 * claro; o terracota acompanha o claro/escuro do sistema.
 */
export function temaKairos(sistemaEscuro: boolean): Tema {
  if (TEMA === 'espacial') return espacial;
  if (TEMA === 'ecologico') return ecologico;
  return sistemaEscuro ? terracotaEscuro : terracotaClaro;
}

// As áreas ganham só um ponto de cor (a mesma família de antes, mais clara no escuro).
const AREA_COR_CLARO: Record<string, string> = {
  Acadêmico: '#2471A3',
  Trabalho: '#9A7B12',
  Institucional: '#4A6178',
  Saúde: '#2E7D4F',
  Pessoal: '#7A3E93',
};

const AREA_COR_ESCURO: Record<string, string> = {
  Acadêmico: '#7FB3E0',
  Trabalho: '#D9B655',
  Institucional: '#A3B6CA',
  Saúde: '#86C79B',
  Pessoal: '#C59ADA',
};

export function corDaArea(area: string, c: Tema): string {
  return (c.escuro ? AREA_COR_ESCURO : AREA_COR_CLARO)[area] ?? c.suave;
}

export function corDaPrioridade(p: string, c: Tema): string {
  return p === 'Alta' ? c.urg : p === 'Baixa' ? c.ok : c.estrela;
}

/** A cor de marca de uma IA, a não ser que suma no fundo (o Grok é quase preto). */
export function corVisivel(cor: string | undefined, c: Tema): string {
  if (!cor || !/^#[0-9a-f]{6}$/i.test(cor)) return c.suave;
  const n = parseInt(cor.slice(1), 16);
  const lum = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  return (c.escuro && lum < 0.2) || (!c.escuro && lum > 0.85) ? c.suave : cor;
}

// Emojis só saem da EXIBIÇÃO: as badges, por exemplo, continuam guardadas como emoji
// (é a chave delas nos dois aparelhos). Faixas explícitas, sem \p{Extended_Pictographic}.
const EMOJI =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2300}-\u{23FF}\u{21A9}\u{21AA}\u{FE0F}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]/gu;

export function semEmoji(s: string): string {
  return s.replace(EMOJI, '').replace(/\s{2,}/g, ' ').trim();
}

/** As fontes da Noosfera, para o Kairós falar com a mesma voz das outras abas. */
export const fonte = {
  marca: 'Nunito_800ExtraBold',
  titulo: 'Nunito_700Bold',
  texto: 'Inter_400Regular',
  medio: 'Inter_500Medium',
  forte: 'Inter_600SemiBold',
} as const;
