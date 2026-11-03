// A paleta do Kairós, a mesma do painel web, que herdou do Graphé. Como o Kinesis,
// o Kairós guarda a cara que já tinha; claro ou escuro conforme o sistema.

export const roxo = '#4A235A';
export const roxo2 = '#5B2C6F';

export const light = {
  bg: '#f5f2f7',
  card: '#ffffff',
  linha: '#e3dce9',
  txt: '#2a2230',
  suave: '#6b6675',
  urgBg: '#FDECEA',
  urgBd: '#E24B4A',
  urgTx: '#7a1f1f',
};

export const dark: typeof light = {
  bg: '#1a151f',
  card: '#241d2b',
  linha: '#3a2f45',
  txt: '#efeaf3',
  suave: '#a99fb5',
  urgBg: '#3a1c1c',
  urgBd: '#E24B4A',
  urgTx: '#f0b9b3',
};

export type Tema = typeof light;

/** Fixas nos dois temas (texto branco por cima funciona em ambos). */
export const fixas = {
  roxo,
  roxo2,
  verde: '#186A3B',
  laranja: '#E65100',
  vermelho: '#c0392b',
  cinza: '#9AA0A6',
  estrela: '#f5b400',
  alta: '#c0392b',
  media: '#d68910',
  baixa: '#27ae60',
};

export const AREA_COR: Record<string, string> = {
  Acadêmico: '#2471A3',
  Trabalho: '#7F6000',
  Institucional: '#34495E',
  Saúde: '#186A3B',
  Pessoal: '#5B2C6F',
};

export const AREA_ICONE: Record<string, string> = {
  Acadêmico: '🎓',
  Trabalho: '💼',
  Institucional: '🏛️',
  Saúde: '🩺',
  Pessoal: '🏠',
};

export const PRIO_COR: Record<string, string> = {
  Alta: fixas.alta,
  Média: fixas.media,
  Baixa: fixas.baixa,
};
