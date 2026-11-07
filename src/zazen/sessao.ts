// As regras do Zazen, sem React e sem nativo: a sessão, a linha do tempo dos sinos
// e o andamento. Tudo ancorado em instantes absolutos (Date.now()), para a tela,
// a notificação e o motor nativo concordarem com a tela apagada ou acesa.
//
// A sequência é a da tradição Sōtō: preparação em silêncio, o shijōshō (três
// toques do sino grave) abre o zazen, avisos discretos se a pessoa quiser, e o
// hōzenshō (um toque) o encerra.

import type { KinesisEvent, KinesisNotif, KinesisTimeline } from '../../modules/kinesis-timer';

export type AvisoModo = 'nenhum' | '5' | '10' | '15' | 'metade';
export type AvisoSom = 'taku' | 'sino';

export interface ZazenPrefs {
  /** Duração do zazen em minutos (1 a 180). */
  minutos: number;
  /** Silêncio antes do primeiro sino, em segundos. */
  preparo: number;
  avisos: AvisoModo;
  avisoSom: AvisoSom;
}

export const PREFS_PADRAO: ZazenPrefs = { minutos: 25, preparo: 15, avisos: 'nenhum', avisoSom: 'taku' };

export const MINUTOS_MIN = 1;
export const MINUTOS_MAX = 180;
export const DURACOES = [10, 15, 20, 25, 30, 40, 45, 60];
export const PREPAROS = [0, 15, 30, 60];
export const AVISOS: AvisoModo[] = ['nenhum', '5', '10', '15', 'metade'];

/** Os sons do motor (KinesisPlayer.resId). O kinhin (dois toques) fica registrado para depois. */
export const SOM = {
  shijo: 'zazenShijo',
  hozen: 'zazenHozen',
  kinhin: 'zazenKinhin',
  sino: 'zazenSino',
  taku: 'zazenTaku',
} as const;

export const SOM_DO_AVISO: Record<AvisoSom, string> = { taku: SOM.taku, sino: SOM.sino };

/** Tocar na notificação abre a aba do Zazen (App.tsx). */
export const LINK = 'askesis://zazen';

export interface ZazenSessao {
  /** Quando "começar" foi tocado: a preparação começa aqui. */
  preparoEm: number;
  /** O primeiro toque do shijōshō: o zazen começa aqui. */
  inicioEm: number;
  /** O hōzenshō. */
  fimEm: number;
  /** Instantes dos avisos, já sem o que cairia no fim. */
  avisos: number[];
  avisoSom: AvisoSom;
  minutos: number;
}

export type Fase = 'preparando' | 'sentado' | 'fim';

export function limitarMinutos(m: number): number {
  if (!Number.isFinite(m)) return PREFS_PADRAO.minutos;
  return Math.max(MINUTOS_MIN, Math.min(MINUTOS_MAX, Math.round(m)));
}

/** Preferências lidas do disco: o que faltar ou vier estranho volta ao padrão. */
export function normalizarPrefs(p: Partial<ZazenPrefs> | undefined | null): ZazenPrefs {
  const base = { ...PREFS_PADRAO, ...(p ?? {}) };
  return {
    minutos: limitarMinutos(Number(base.minutos)),
    preparo: PREPAROS.includes(Number(base.preparo)) ? Number(base.preparo) : PREFS_PADRAO.preparo,
    avisos: AVISOS.includes(base.avisos) ? base.avisos : PREFS_PADRAO.avisos,
    avisoSom: base.avisoSom === 'sino' ? 'sino' : 'taku',
  };
}

/**
 * Os instantes dos avisos entre o início e o fim. Um aviso que cairia no fim
 * não toca: ali quem fala é o hōzenshō.
 */
export function instantesDosAvisos(modo: AvisoModo, inicioEm: number, fimEm: number): number[] {
  const duracao = fimEm - inicioEm;
  if (duracao <= 0 || modo === 'nenhum') return [];
  if (modo === 'metade') {
    const at = inicioEm + Math.round(duracao / 2);
    return at > inicioEm && at < fimEm ? [at] : [];
  }
  const passo = Number(modo) * 60_000;
  const lista: number[] = [];
  for (let at = inicioEm + passo; at < fimEm; at += passo) lista.push(at);
  return lista;
}

/** Monta a sessão a partir das preferências, no instante em que "começar" foi tocado. */
export function planejarSessao(prefs: ZazenPrefs, agora: number): ZazenSessao {
  const minutos = limitarMinutos(prefs.minutos);
  const inicioEm = agora + Math.max(0, prefs.preparo) * 1000;
  const fimEm = inicioEm + minutos * 60_000;
  return {
    preparoEm: agora,
    inicioEm,
    fimEm,
    avisos: instantesDosAvisos(prefs.avisos, inicioEm, fimEm),
    avisoSom: prefs.avisoSom,
    minutos,
  };
}

export function faseEm(s: ZazenSessao, agora: number): Fase {
  if (agora < s.inicioEm) return 'preparando';
  if (agora < s.fimEm) return 'sentado';
  return 'fim';
}

export interface Andamento {
  fase: Fase;
  /** Fração do zazen já sentada (0 a 1): é o quanto do ensō está pintado. */
  frac: number;
  /** Minutos que faltam, arredondados para cima: 25 no começo, 1 no último minuto. */
  minutosRestantes: number;
  /** Segundos até o primeiro sino (só na preparação). */
  segundosDePreparo: number;
}

export function andamento(s: ZazenSessao, agora: number): Andamento {
  const fase = faseEm(s, agora);
  const total = Math.max(1, s.fimEm - s.inicioEm);
  const frac = Math.max(0, Math.min(1, (agora - s.inicioEm) / total));
  const restante = Math.max(0, s.fimEm - Math.max(agora, s.inicioEm));
  return {
    fase,
    frac,
    minutosRestantes: fase === 'fim' ? 0 : Math.max(1, Math.ceil(restante / 60_000)),
    segundosDePreparo: fase === 'preparando' ? Math.max(1, Math.ceil((s.inicioEm - agora) / 1000)) : 0,
  };
}

/** Minutos de fato sentados (do primeiro sino até agora ou até o fim), inteiros. */
export function minutosSentados(s: ZazenSessao, agora: number): number {
  if (agora <= s.inicioEm) return 0;
  if (agora >= s.fimEm) return s.minutos;
  return Math.floor((agora - s.inicioEm) / 60_000);
}

const TITULO = '坐禅 · Zazen';

function notifPreparo(s: ZazenSessao): KinesisNotif {
  return { title: 'Zazen · preparando', text: 'o primeiro sino marca o início', chronoTo: s.inicioEm, chronoDown: true };
}

function notifSentado(s: ZazenSessao): KinesisNotif {
  return { title: TITULO, text: `${s.minutos} min`, chronoTo: s.fimEm, chronoDown: true };
}

export type ZazenTimeline = KinesisTimeline & { link: string };

/**
 * O futuro da sessão a partir de agora, para o motor nativo tocar sozinho. Um
 * evento exatamente em `agora` entra (sem preparação, o shijōshō sai na hora);
 * os que já passaram, não: o motor tocaria o último vencido, atrasado.
 */
export function linhaDoTempo(s: ZazenSessao, agora: number): ZazenTimeline {
  const fase = faseEm(s, agora);
  const events: KinesisEvent[] = [];
  if (fase === 'fim') return { link: LINK, current: null, events };
  if (s.inicioEm >= agora) {
    events.push({ at: s.inicioEm, sound: SOM.shijo, notif: notifSentado(s) });
  }
  const somAviso = SOM_DO_AVISO[s.avisoSom] ?? SOM.taku;
  for (const at of s.avisos) {
    if (at > agora && at < s.fimEm) events.push({ at, sound: somAviso });
  }
  events.push({
    at: s.fimEm,
    sound: SOM.hozen,
    finish: true,
    notif: { title: TITULO, text: '合掌 · gasshō', chronoTo: 0, chronoDown: true },
  });
  return {
    link: LINK,
    current: fase === 'preparando' && s.inicioEm > agora ? notifPreparo(s) : notifSentado(s),
    events: events.sort((a, b) => a.at - b.at),
  };
}

export function chaveDoDia(ts: number = Date.now()): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Soma minutos ao dia e guarda só o último ano. */
export function somarAoDia(dias: Record<string, number>, ts: number, minutos: number): Record<string, number> {
  if (minutos <= 0) return dias;
  const chave = chaveDoDia(ts);
  const novo = { ...dias, [chave]: (dias[chave] ?? 0) + minutos };
  const chaves = Object.keys(novo).sort();
  for (const velha of chaves.slice(0, Math.max(0, chaves.length - 366))) delete novo[velha];
  return novo;
}
