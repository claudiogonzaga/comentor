// As regras do timer do Kinesis, sem React e sem nativo.
//
// É a lógica do popup.js do app do Mac, com uma diferença de fundo: lá o timer
// roda na janela, sempre acordada. No celular o JS congela com a tela apagada,
// então cada fase é ancorada no fim da anterior (e não em "agora") e o futuro é
// calculado de uma vez: buildTimeline entrega a linha do tempo inteira ao nativo,
// que toca os sinos sozinho, e advance() põe o estado em dia quando o app volta.

import type { KinesisEvent, KinesisNotif, KinesisTimeline } from '../../modules/kinesis-timer';

export type Phase = 'prepare' | 'work' | 'rest' | 'snooze' | 'finished';

export interface KinesisConfig {
  sets: number;
  prepare: number; // segundos; 0 = sem preparação
  work: number;
  rest: number;
  workSound: string;
  restSound: string;
  alertSound: string; // alerta quando o exercício não é confirmado
  alertEvery: number; // minutos entre os alertas
  snoozeMinutes: number;
  preExercisePercent: number; // avisa quando resta esta fração do trabalho (0 = não)
  preExerciseCount: number;
  preExerciseSound: string;
}

export const DEFAULT_CONFIG: KinesisConfig = {
  sets: 6,
  prepare: 0,
  work: 30 * 60,
  rest: 3 * 60,
  workSound: 'schoolBell',
  restSound: 'whistle',
  alertSound: 'alarm',
  alertEvery: 2,
  snoozeMinutes: 5,
  preExercisePercent: 10,
  preExerciseCount: 1,
  preExerciseSound: 'gentle',
};

export type NumericField = 'sets' | 'prepare' | 'work' | 'rest';

export const LIMITS: Record<NumericField, { min: number; max: number }> = {
  sets: { min: 1, max: 99 },
  prepare: { min: 0, max: 99 * 60 + 59 },
  work: { min: 1, max: 99 * 60 + 59 },
  rest: { min: 0, max: 99 * 60 + 59 },
};

export const PHASE_LABEL: Record<Phase, string> = {
  prepare: 'PREPARAR',
  work: 'TRABALHAR',
  rest: 'Exercite-se!',
  snooze: 'SONECA',
  finished: 'PRONTO',
};

export interface TimerState {
  running: boolean;
  paused: boolean;
  config: KinesisConfig;
  currentSet: number;
  phase: Phase;
  phaseEndAt: number;
  pauseRemainingMs: number;
  checkedExercises: string[];
  awaitingConfirm: boolean;
  nextAlertAt: number | null;
  // O relógio do atraso: corre desde a PRIMEIRA janela de exercício perdida,
  // atravessa "EXERCITAR AGORA" e soneca, e só o EXERCITEI o zera.
  overdueSince: number | null;
  overduePausedAt: number | null;
  roundSnoozed: boolean;
}

/** O que muda o estado e, às vezes, toca um som na hora (o toque já foi dado). */
export interface Step {
  state: TimerState;
  sound?: string;
}

/** Fases em que o exercício ainda é devido: o atraso corre e EXERCITEI é a saída. */
export function isCallPhase(phase: Phase): boolean {
  return phase === 'rest' || phase === 'snooze';
}

/** Janela mínima pedida pela pessoa: um exercício de 0 s acabaria ao começar. */
const MIN_EXERCISE_WINDOW = 5;
/** "Voltar" até aqui depois do início ainda volta ao intervalo anterior. */
const PREV_RESTART_THRESHOLD = 2;
/** No telefone o alerta para sozinho: esquecido na mesa, não toca a noite inteira. */
const NAG_WINDOW_MIN = 30;
/** Fase mais curta que isto não tem os bipes dos últimos 3 segundos. */
const BEEPS_MIN_SECONDS = 4;

export function fmtTime(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

/** "45", "4500", "45:00" → segundos, com as mesmas regras do campo do Mac. */
export function parseTime(raw: string): number {
  const text = String(raw).trim();
  if (!text) return NaN;
  if (/^\d+:\d{1,2}$/.test(text)) {
    const [m, s] = text.split(':').map((part) => parseInt(part, 10));
    if (s >= 60) return NaN;
    return m * 60 + s;
  }
  if (/^\d+$/.test(text)) {
    if (text.length <= 2) return parseInt(text, 10);
    const minutes = parseInt(text.slice(0, -2), 10);
    const seconds = parseInt(text.slice(-2), 10);
    if (seconds >= 60) return NaN;
    return minutes * 60 + seconds;
  }
  return NaN;
}

export function parseField(field: NumericField, raw: string): number {
  if (field === 'sets') {
    const value = parseInt(String(raw).replace(/\D/g, ''), 10);
    return Number.isFinite(value) ? value : NaN;
  }
  return parseTime(raw);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function alertIntervalMs(cfg: KinesisConfig): number {
  return Math.max(1, Number(cfg.alertEvery) || 2) * 60_000;
}

function snoozeSeconds(cfg: KinesisConfig): number {
  return Math.max(1, Number(cfg.snoozeMinutes) || 5) * 60;
}

function exerciseWindowSeconds(cfg: KinesisConfig): number {
  return Math.max(MIN_EXERCISE_WINDOW, Number(cfg.rest) || 0);
}

export function preExerciseCount(cfg: KinesisConfig): number {
  return Math.max(1, Math.min(5, Number(cfg.preExerciseCount) || 1));
}

function preExerciseWindow(cfg: KinesisConfig): number {
  const pct = Number(cfg.preExercisePercent) || 0;
  if (pct <= 0) return 0;
  return Math.round((((Number(cfg.work) || 0) * (pct / 100)) / 60)) * 60;
}

/** Faltas de tempo (s) de cada aviso antes do sino, da mais distante à mais próxima. */
export function preExerciseMarks(cfg: KinesisConfig): number[] {
  const base = preExerciseWindow(cfg);
  if (base <= 0) return [];
  const count = preExerciseCount(cfg);
  const marks: number[] = [];
  for (let k = count; k >= 1; k -= 1) marks.push(Math.round((base * k) / count));
  return marks.filter((seconds) => seconds > 0);
}

export function preExerciseHint(cfg: KinesisConfig): string {
  const marks = preExerciseMarks(cfg);
  if (!marks.length) return 'Avisos desligados.';
  const tempos = marks.map((seconds) => fmtTime(seconds));
  const lista =
    tempos.length > 1 ? `${tempos.slice(0, -1).join(', ')} e ${tempos[tempos.length - 1]}` : tempos[0];
  return tempos.length === 1
    ? `1 aviso antes do sino: faltando ${lista}.`
    : `${tempos.length} avisos antes do sino: faltando ${lista}.`;
}

function phaseDuration(phase: Phase, cfg: KinesisConfig): number {
  if (phase === 'prepare') return cfg.prepare;
  if (phase === 'rest') return cfg.rest;
  if (phase === 'snooze') return snoozeSeconds(cfg);
  return cfg.work;
}

export function phaseTotalSeconds(s: TimerState): number {
  return phaseDuration(s.phase, s.config);
}

function soundOfPhase(phase: Phase, cfg: KinesisConfig): string | undefined {
  if (phase === 'work') return cfg.workSound || 'schoolBell';
  if (phase === 'rest') return cfg.restSound || 'whistle';
  if (phase === 'prepare') return 'prepare';
  if (phase === 'finished') return 'finished';
  return undefined;
}

export function remainingSeconds(s: TimerState, now: number): number {
  if (s.paused) return Math.max(0, Math.ceil((s.pauseRemainingMs || 0) / 1000));
  return Math.max(0, Math.ceil(((s.phaseEndAt || 0) - now) / 1000));
}

/** Há quanto tempo (s) o exercício está atrasado; null antes de a primeira janela vencer. */
export function overdueSeconds(s: TimerState, now: number): number | null {
  if (!s.overdueSince) return null;
  const ref = s.paused && s.overduePausedAt ? s.overduePausedAt : now;
  return Math.max(0, Math.floor((ref - s.overdueSince) / 1000));
}

export function startTimer(config: KinesisConfig, now: number): Step {
  const firstPhase: Phase = config.prepare > 0 ? 'prepare' : 'work';
  const seconds = firstPhase === 'prepare' ? config.prepare : config.work;
  return {
    state: {
      running: true,
      paused: false,
      config: { ...config },
      currentSet: 1,
      phase: firstPhase,
      phaseEndAt: now + seconds * 1000,
      pauseRemainingMs: 0,
      checkedExercises: [],
      awaitingConfirm: false,
      nextAlertAt: null,
      overdueSince: null,
      overduePausedAt: null,
      roundSnoozed: false,
    },
    sound: soundOfPhase(firstPhase, config),
  };
}

export function pauseTimer(s: TimerState, now: number): TimerState {
  if (!s.running || s.paused) return s;
  return {
    ...s,
    paused: true,
    pauseRemainingMs: Math.max(0, s.phaseEndAt - now),
    overduePausedAt: s.overdueSince ? now : s.overduePausedAt,
  };
}

export function resumeTimer(s: TimerState, now: number): TimerState {
  if (!s.running || !s.paused) return s;
  return {
    ...s,
    paused: false,
    phaseEndAt: now + s.pauseRemainingMs,
    pauseRemainingMs: 0,
    // Tempo em pausa não é atraso.
    overdueSince:
      s.overdueSince && s.overduePausedAt ? s.overdueSince + (now - s.overduePausedAt) : s.overdueSince,
    overduePausedAt: null,
  };
}

/** Bloco novo: tudo o que era da rodada anterior fica para trás. */
function clearRound(s: TimerState): TimerState {
  return {
    ...s,
    checkedExercises: [],
    roundSnoozed: false,
    awaitingConfirm: false,
    nextAlertAt: null,
    overdueSince: null,
    overduePausedAt: null,
  };
}

function finished(s: TimerState): TimerState {
  return { ...clearRound(s), running: false, paused: false, phase: 'finished', pauseRemainingMs: 0 };
}

/**
 * Põe o estado em dia com o relógio, sem tocar nada (os sinos são do nativo).
 * Cada fase começa onde a anterior terminou: com a tela apagada ou acesa, o
 * resultado é o mesmo, e o mesmo da linha do tempo entregue ao nativo.
 */
export function advance(state: TimerState, now: number): TimerState {
  if (!state.running || state.paused) return state;
  let s = state;
  // Com o limite bastam poucas voltas; a trava só protege de configuração absurda.
  for (let guard = 0; guard < 500; guard += 1) {
    if (s.awaitingConfirm || now < s.phaseEndAt) return s;
    const end = s.phaseEndAt;
    if (s.phase === 'prepare') {
      s = { ...clearRound(s), phase: 'work', phaseEndAt: end + s.config.work * 1000 };
    } else if (s.phase === 'work') {
      if (s.currentSet >= s.config.sets) return finished(s);
      s = { ...clearRound(s), phase: 'rest', phaseEndAt: end + s.config.rest * 1000 };
    } else if (s.phase === 'snooze') {
      s = { ...s, phase: 'rest', phaseEndAt: end + exerciseWindowSeconds(s.config) * 1000 };
    } else if (s.phase === 'rest') {
      // O exercício NÃO avança sozinho: fica esperando a confirmação.
      s = {
        ...s,
        awaitingConfirm: true,
        nextAlertAt: end + alertIntervalMs(s.config),
        overdueSince: s.overdueSince ?? end,
      };
    } else {
      return s;
    }
  }
  return s;
}

/** "EXERCITAR AGORA": outra janela cheia, com apito. O atraso segue correndo. */
export function exerciseNow(s: TimerState, now: number): Step {
  if (!isCallPhase(s.phase) || (s.phase === 'rest' && !s.awaitingConfirm)) return { state: s };
  return {
    state: {
      ...s,
      phase: 'rest',
      awaitingConfirm: false,
      nextAlertAt: null,
      phaseEndAt: now + exerciseWindowSeconds(s.config) * 1000,
    },
    sound: s.config.restSound || 'whistle',
  };
}

/** "ADIAR": recua pelos minutos configurados e volta a chamar. Adiar não é exercitar. */
export function snoozeTimer(s: TimerState, now: number): Step {
  if (s.phase !== 'rest') return { state: s };
  return {
    state: {
      ...s,
      phase: 'snooze',
      awaitingConfirm: false,
      nextAlertAt: null,
      roundSnoozed: true,
      overdueSince: s.overdueSince ?? now,
      phaseEndAt: now + snoozeSeconds(s.config) * 1000,
    },
    sound: 'gentle',
  };
}

/** "EXERCITEI": encerra a rodada e segue para o próximo bloco de trabalho. */
export function confirmTimer(s: TimerState, now: number): Step {
  if (!isCallPhase(s.phase)) return { state: s };
  return {
    state: {
      ...clearRound(s),
      phase: 'work',
      currentSet: s.currentSet + 1,
      phaseEndAt: now + s.config.work * 1000,
    },
    sound: s.config.workSound || 'schoolBell',
  };
}

interface TimelineStep {
  phase: Phase;
  set: number;
}

function stepsOf(cfg: KinesisConfig): TimelineStep[] {
  const steps: TimelineStep[] = [];
  if ((cfg.prepare || 0) > 0) steps.push({ phase: 'prepare', set: 1 });
  const sets = cfg.sets || 1;
  for (let i = 1; i <= sets; i += 1) {
    steps.push({ phase: 'work', set: i });
    if (i < sets) steps.push({ phase: 'rest', set: i });
  }
  return steps;
}

/** Pular para o intervalo seguinte (+1) ou anterior (−1). */
export function jumpTimer(s: TimerState, direction: 1 | -1, now: number): Step {
  const steps = stepsOf(s.config);
  // A soneca não é um passo próprio: pular dela é como pular do exercício.
  const here = s.phase === 'snooze' ? 'rest' : s.phase;
  let idx =
    s.phase === 'finished'
      ? steps.length
      : steps.findIndex((x) => x.phase === here && x.set === s.currentSet);
  if (idx < 0) idx = 0;
  const target = idx + direction;
  if (target >= steps.length) return { state: finished(s), sound: 'finished' };
  const step = steps[Math.max(0, target)];
  return {
    state: {
      ...clearRound(s),
      running: true,
      paused: false,
      pauseRemainingMs: 0,
      currentSet: step.set,
      phase: step.phase,
      phaseEndAt: now + phaseDuration(step.phase, s.config) * 1000,
    },
    sound: soundOfPhase(step.phase, s.config),
  };
}

/** Como no tocador de música: o 1º toque volta ao início; no início, vai ao anterior. */
export function prevTimer(s: TimerState, now: number): Step {
  if (s.phase === 'finished') return jumpTimer(s, -1, now);
  const elapsed = phaseDuration(s.phase, s.config) - remainingSeconds(s, now);
  if (elapsed > PREV_RESTART_THRESHOLD) {
    return {
      state: {
        ...s,
        running: true,
        paused: false,
        pauseRemainingMs: 0,
        awaitingConfirm: false,
        nextAlertAt: null,
        checkedExercises: [],
        phaseEndAt: now + phaseDuration(s.phase, s.config) * 1000,
      },
    };
  }
  return jumpTimer(s, -1, now);
}

function seriesText(s: { currentSet: number; config: KinesisConfig }): string {
  return `Série ${s.currentSet} / ${s.config.sets}`;
}

function countdownNotif(title: string, text: string, to: number): KinesisNotif {
  return { title, text, chronoTo: to, chronoDown: true };
}

const CALL_HINT = 'toque para marcar os exercícios';

/** A notificação do estado de agora. */
function currentNotif(s: TimerState): KinesisNotif | null {
  if (!s.running) return null;
  const text = seriesText(s);
  if (s.paused) {
    const label = s.awaitingConfirm ? 'EXERCITOU?' : PHASE_LABEL[s.phase];
    return { title: `${label} — em pausa`, text, chronoTo: 0, chronoDown: true };
  }
  if (s.awaitingConfirm) {
    return {
      title: 'EXERCITOU?',
      text: `${text} · ${CALL_HINT}`,
      chronoTo: s.overdueSince ?? s.phaseEndAt,
      chronoDown: false,
    };
  }
  const call = isCallPhase(s.phase);
  return countdownNotif(PHASE_LABEL[s.phase], call ? `${text} · ${CALL_HINT}` : text, s.phaseEndAt);
}

/**
 * O futuro inteiro, a partir do estado de agora, até onde ele depende só do
 * relógio: a próxima confirmação de exercício ou o fim do treino. O nativo
 * executa isto sozinho, com o app fechado. É o mesmo caminho de advance().
 */
export function buildTimeline(s: TimerState, now: number): KinesisTimeline {
  const events: KinesisEvent[] = [];
  const current = currentNotif(s);
  if (!s.running || s.paused) return { current, events };

  const cfg = s.config;
  const nag = (from: number): KinesisEvent => ({
    at: Math.max(from, now + 1000),
    sound: cfg.alertSound || 'alarm',
    vibrate: true,
    repeatMs: alertIntervalMs(cfg),
    repeatLeft: Math.max(0, Math.ceil(NAG_WINDOW_MIN / Math.max(1, cfg.alertEvery || 2)) - 1),
  });
  if (s.awaitingConfirm) {
    events.push(nag(s.nextAlertAt ?? now + alertIntervalMs(cfg)));
    return { current, events };
  }

  const beepsFor = (seconds: number) => seconds >= BEEPS_MIN_SECONDS;
  const workMarks = (end: number) => {
    for (const mark of preExerciseMarks(cfg)) {
      const at = end - mark * 1000;
      if (at > now) events.push({ at, sound: cfg.preExerciseSound || 'gentle' });
    }
  };

  // A caminhada para na primeira confirmação: a série não muda no caminho.
  const set = s.currentSet;
  const text = seriesText(s);
  let phase = s.phase;
  let end = s.phaseEndAt;
  let phaseSeconds = phaseDuration(phase, cfg);
  if (phase === 'work') workMarks(end);

  for (let guard = 0; guard < 8; guard += 1) {
    if (phase === 'prepare') {
      const next = end + cfg.work * 1000;
      events.push({
        at: end,
        sound: cfg.workSound || 'schoolBell',
        beeps: beepsFor(phaseSeconds),
        vibrate: true,
        notif: countdownNotif(PHASE_LABEL.work, text, next),
      });
      phase = 'work';
      end = next;
      phaseSeconds = cfg.work;
      workMarks(end);
    } else if (phase === 'work') {
      if (set >= cfg.sets) {
        events.push({
          at: end,
          sound: 'finished',
          beeps: beepsFor(phaseSeconds),
          vibrate: true,
          finish: true,
          notif: { title: PHASE_LABEL.finished, text: 'Treino concluído', chronoTo: 0, chronoDown: true },
        });
        break;
      }
      const next = end + cfg.rest * 1000;
      events.push({
        at: end,
        sound: cfg.restSound || 'whistle',
        beeps: beepsFor(phaseSeconds),
        vibrate: true,
        notif: countdownNotif(PHASE_LABEL.rest, `${text} · ${CALL_HINT}`, next),
      });
      phase = 'rest';
      end = next;
      phaseSeconds = cfg.rest;
    } else if (phase === 'snooze') {
      const seconds = exerciseWindowSeconds(cfg);
      const next = end + seconds * 1000;
      events.push({
        at: end,
        sound: cfg.restSound || 'whistle',
        beeps: beepsFor(phaseSeconds),
        vibrate: true,
        notif: countdownNotif(PHASE_LABEL.rest, `${text} · ${CALL_HINT}`, next),
      });
      phase = 'rest';
      end = next;
      phaseSeconds = seconds;
    } else if (phase === 'rest') {
      // Janela pedida pela pessoa termina com um sinal; a primeira, não: nada foi prometido.
      events.push({
        at: end,
        sound: s.overdueSince ? 'exerciseEnd' : null,
        beeps: beepsFor(phaseSeconds),
        vibrate: true,
        notif: {
          title: 'EXERCITOU?',
          text: `${text} · ${CALL_HINT}`,
          chronoTo: s.overdueSince ?? end,
          chronoDown: false,
        },
      });
      events.push(nag(end + alertIntervalMs(cfg)));
      break;
    } else {
      break;
    }
  }
  return { current, events: events.sort((a, b) => a.at - b.at) };
}

// ---- sonecas: 3 no total, e só voltam depois de 3 rodadas seguidas sem adiar ----

export const SNOOZE_MAX = 3;
export const SNOOZE_RECOVERY_ROUNDS = 3;

export interface SnoozeBudget {
  used: number;
  clean: number;
}

export function snoozesLeft(b: SnoozeBudget): number {
  return Math.max(0, SNOOZE_MAX - b.used);
}

export function roundsToUnlock(b: SnoozeBudget): number {
  return Math.max(0, SNOOZE_RECOVERY_ROUNDS - b.clean);
}

/** Fecha a rodada: quem adiou quebra a sequência; três limpas devolvem as sonecas. */
export function settleSnoozeRound(b: SnoozeBudget, usedSnooze: boolean): SnoozeBudget {
  const clean = usedSnooze ? 0 : b.clean + 1;
  if (clean >= SNOOZE_RECOVERY_ROUNDS) return { used: 0, clean: 0 };
  return { used: b.used, clean };
}
