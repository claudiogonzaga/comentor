// O estado do Kinesis: configuração, exercícios, circuitos, histórico e o timer.
//
// Tudo fica em app_kv, no banco do Áskesis (entra no backup). Os sinos saem do
// módulo nativo: a cada mudança no timer, a linha do tempo inteira é entregue a
// ele e o JS só precisa manter a tela em dia.

import * as Font from 'expo-font';
import { AppState } from 'react-native';
import { create } from 'zustand';

import KinesisTimer from '../../modules/kinesis-timer';
import { getKV, setKV } from '../services/database';
import {
  advance,
  buildTimeline,
  clamp,
  confirmTimer,
  DEFAULT_CONFIG,
  exerciseNow,
  isCallPhase,
  jumpTimer,
  LIMITS,
  pauseTimer,
  prevTimer,
  resumeTimer,
  settleSnoozeRound,
  snoozesLeft,
  snoozeTimer,
  startTimer,
  type KinesisConfig,
  type NumericField,
  type SnoozeBudget,
  type Step,
  type TimerState,
} from './timer';

export type Region = 'lower' | 'core' | 'upper' | 'full';
export type PeriodId = 'morning' | 'afternoon' | 'night';

export interface Exercise {
  id: string;
  name: string;
  region: Region;
}

export interface Circuit {
  id: string;
  name: string;
  days: number[]; // 0 = domingo … 6 = sábado
  periods: PeriodId[];
  region: Region | null;
  items: string[]; // ids de exercícios
}

export interface HistoryEntry {
  date: string; // YYYY-MM-DD local
  ts: number;
  items: { id: string; name: string; region: Region }[];
}

export interface Preset {
  id: string;
  name: string;
  sets: number;
  prepare: number;
  work: number;
  rest: number;
  workSound?: string;
  restSound?: string;
  alertSound?: string;
  alertEvery?: number;
  snoozeMinutes?: number;
  preExercisePercent?: number;
  preExerciseCount?: number;
  preExerciseSound?: string;
}

/** O dia cortado em três períodos: a noite conta para o dia em que o relógio está. */
export const PERIODS: { id: PeriodId; label: string; short: string; hours: string; start: number }[] = [
  { id: 'morning', label: 'manhã', short: 'MANHÃ', hours: '5h–12h', start: 5 * 60 },
  { id: 'afternoon', label: 'tarde', short: 'TARDE', hours: '12h–18h', start: 12 * 60 },
  { id: 'night', label: 'noite', short: 'NOITE', hours: '18h–5h', start: 18 * 60 },
];

export const REGIONS: Region[] = ['lower', 'core', 'upper', 'full'];
export const REGION_SHORT: Record<Region, string> = { lower: 'LOWER', core: 'CORE', upper: 'UPPER', full: 'FULL' };
export const REGION_LABEL: Record<Region, string> = { lower: 'Lower', core: 'Core', upper: 'Upper', full: 'Full body' };
export const REGION_LETTER: Record<Region, string> = { lower: 'L', core: 'C', upper: 'U', full: 'F' };
export const WD_LETTER = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
export const WD_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

const SEED_EXERCISES: { name: string; region: Region }[] = [
  { name: 'Flexões', region: 'upper' },
  { name: 'Agachamento', region: 'lower' },
  { name: 'Prancha', region: 'full' },
  { name: 'Polichinelo', region: 'full' },
];

const REGION_ORDER: Record<string, number> = { lower: 0, core: 1, upper: 2, full: 3 };

/** Do frio ao quente (lower, core, upper, full), alfabético dentro de cada grupo. */
export function sortedExercises(list: Exercise[]): Exercise[] {
  return list.slice().sort(
    (a, b) =>
      (REGION_ORDER[a.region] ?? 99) - (REGION_ORDER[b.region] ?? 99) ||
      a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }),
  );
}

export function periodAt(when: Date): PeriodId {
  const minute = when.getHours() * 60 + when.getMinutes();
  if (minute >= 5 * 60 && minute < 12 * 60) return 'morning';
  if (minute >= 12 * 60 && minute < 18 * 60) return 'afternoon';
  return 'night';
}

/** Todos os circuitos deste dia e período: esconder um esconderia trabalho planejado. */
export function activeCircuits(circuits: Circuit[], when: Date): Circuit[] {
  const day = when.getDay();
  const period = periodAt(when);
  return circuits.filter((c) => c.days.includes(day) && (c.periods || []).includes(period));
}

/** O horário mais próximo a partir de agora, olhando uma semana à frente. */
export function nextCircuitSlot(
  circuits: Circuit[],
  when: Date,
): { circuit: Circuit; day: number; period: (typeof PERIODS)[number] } | null {
  const nowDay = when.getDay();
  const nowMinute = when.getHours() * 60 + when.getMinutes();
  let best: { circuit: Circuit; day: number; period: (typeof PERIODS)[number]; distance: number } | null = null;
  for (const circuit of circuits) {
    for (const day of circuit.days) {
      for (const periodId of circuit.periods || []) {
        const period = PERIODS.find((p) => p.id === periodId);
        if (!period) continue;
        let daysAhead = (day - nowDay + 7) % 7;
        if (daysAhead === 0 && period.start <= nowMinute) daysAhead = 7;
        const distance = daysAhead * 1440 + period.start - nowMinute;
        if (!best || distance < best.distance) best = { circuit, day, period, distance };
      }
    }
  }
  return best;
}

export function dayKey(ts: number = Date.now()): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function newId(): string {
  return `x${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

const KEYS = {
  config: 'kinesis:config',
  presets: 'kinesis:presets',
  exercises: 'kinesis:exercises',
  history: 'kinesis:history',
  circuits: 'kinesis:circuits',
  snooze: 'kinesis:snooze',
  volume: 'kinesis:volume',
  minutesOnly: 'kinesis:minutesOnly',
  timer: 'kinesis:timer',
} as const;

function save(key: string, value: unknown): void {
  void setKV(key, JSON.stringify(value)).catch((err) => console.warn('[kinesis] não salvou', key, err));
}

async function read<T>(key: string): Promise<T | undefined> {
  try {
    const raw = await getKV(key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

function play(sound: string | undefined): void {
  if (!sound) return;
  try {
    KinesisTimer?.play(sound);
  } catch (err) {
    console.warn('[kinesis] som falhou:', err);
  }
}

/** Entrega ao nativo o futuro do timer. Sem timer rodando, cala tudo. */
function syncNative(timer: TimerState | null): void {
  try {
    if (!KinesisTimer) return;
    if (!timer || !timer.running) {
      KinesisTimer.disarm();
      return;
    }
    KinesisTimer.arm(JSON.stringify(buildTimeline(timer, Date.now())));
  } catch (err) {
    console.warn('[kinesis] não armou a linha do tempo:', err);
  }
}

export interface ImportedData {
  config?: Partial<KinesisConfig>;
  presets?: Preset[];
  exercises?: Exercise[];
  circuits?: Circuit[];
  history?: HistoryEntry[];
  snooze?: SnoozeBudget;
  volume?: number;
  minutesOnly?: boolean;
}

interface KinesisStore {
  loaded: boolean;
  config: KinesisConfig;
  presets: Preset[];
  exercises: Exercise[];
  circuits: Circuit[];
  history: HistoryEntry[];
  budget: SnoozeBudget;
  volume: number;
  minutesOnly: boolean;
  timer: TimerState | null;

  load(): Promise<void>;
  /** Põe o timer em dia com o relógio (a cada batida da tela e ao voltar ao app). */
  tick(): void;

  bumpField(field: NumericField, direction: number): void;
  setField(field: NumericField, value: number): void;
  patchConfig(patch: Partial<KinesisConfig>): void;
  setVolume(volume: number): void;
  setMinutesOnly(value: boolean): void;
  preview(sound: string): void;

  start(): void;
  stop(): void;
  togglePause(): void;
  exerciseNow(): void;
  snooze(): void;
  confirm(): void;
  confirmCircuit(): void;
  next(): void;
  prev(): void;
  toggleChecked(id: string, on: boolean): void;

  addExercise(name: string, region: Region): string;
  updateExercise(id: string, name: string, region: Region): void;
  deleteExercise(id: string): void;
  saveCircuit(id: string | null, data: Omit<Circuit, 'id'>): void;
  deleteCircuit(id: string): void;
  savePreset(name: string): void;
  loadPreset(preset: Preset): void;
  deletePreset(id: string): void;

  exportData(): ImportedData;
  importData(data: ImportedData): void;
}

export const useKinesis = create<KinesisStore>((set, get) => {
  /** Aplica um passo do timer: estado, disco, som do toque e linha do tempo nova. */
  const apply = (step: Step) => {
    set({ timer: step.state });
    save(KEYS.timer, step.state);
    play(step.sound);
    syncNative(step.state);
  };

  const withTimer = (fn: (t: TimerState, now: number) => Step) => {
    const t = get().timer;
    if (!t) return;
    const now = Date.now();
    apply(fn(advance(t, now), now));
  };

  const logSession = (t: TimerState) => {
    const ids = new Set(t.checkedExercises);
    const items = get()
      .exercises.filter((ex) => ids.has(ex.id))
      .map((ex) => ({ id: ex.id, name: ex.name, region: ex.region }));
    const history = [...get().history, { date: dayKey(), ts: Date.now(), items }];
    set({ history });
    save(KEYS.history, history);
    const budget = settleSnoozeRound(get().budget, t.roundSnoozed);
    set({ budget });
    save(KEYS.snooze, budget);
  };

  const pruneCircuits = (exercises: Exercise[], circuits: Circuit[]): Circuit[] => {
    const alive = new Set(exercises.map((e) => e.id));
    return circuits
      .map((c) => ({ ...c, items: c.items.filter((id) => alive.has(id)) }))
      .filter((c) => c.items.length > 0);
  };

  return {
    loaded: false,
    config: { ...DEFAULT_CONFIG },
    presets: [],
    exercises: [],
    circuits: [],
    history: [],
    budget: { used: 0, clean: 0 },
    volume: 0.6,
    minutesOnly: true,
    timer: null,

    load: async () => {
      const [config, presets, exercises, history, circuits, snooze, volume, minutesOnly, timer] =
        await Promise.all([
          read<Partial<KinesisConfig>>(KEYS.config),
          read<Preset[]>(KEYS.presets),
          read<Exercise[]>(KEYS.exercises),
          read<HistoryEntry[]>(KEYS.history),
          read<Circuit[]>(KEYS.circuits),
          read<SnoozeBudget>(KEYS.snooze),
          read<number>(KEYS.volume),
          read<boolean>(KEYS.minutesOnly),
          read<TimerState>(KEYS.timer),
        ]);
      let seeded = exercises;
      if (!Array.isArray(seeded)) {
        seeded = SEED_EXERCISES.map((e) => ({ id: newId(), ...e }));
        save(KEYS.exercises, seeded);
      }
      const vol = typeof volume === 'number' ? volume : 0.6;
      const restored = timer?.running ? advance(timer, Date.now()) : null;
      set({
        loaded: true,
        config: { ...DEFAULT_CONFIG, ...config },
        presets: Array.isArray(presets) ? presets : [],
        exercises: seeded,
        history: Array.isArray(history) ? history : [],
        circuits: Array.isArray(circuits) ? circuits : [],
        budget: snooze ?? { used: 0, clean: 0 },
        volume: vol,
        minutesOnly: typeof minutesOnly === 'boolean' ? minutesOnly : true,
        timer: restored,
      });
      try {
        KinesisTimer?.setVolume(vol);
      } catch {
        /* sem módulo nativo */
      }
      // O app abriu com o timer rodando: a notificação e o próximo sino seguem valendo.
      if (restored) syncNative(restored);
    },

    tick: () => {
      const t = get().timer;
      if (!t || !t.running || t.paused) return;
      const now = Date.now();
      const nowState = advance(t, now);
      if (nowState === t) return;
      set({ timer: nowState });
      save(KEYS.timer, nowState);
    },

    bumpField: (field, direction) => {
      const rule = LIMITS[field];
      const config = { ...get().config, [field]: clamp(get().config[field] + direction, rule.min, rule.max) };
      set({ config });
      save(KEYS.config, config);
    },
    setField: (field, value) => {
      const rule = LIMITS[field];
      const config = { ...get().config, [field]: clamp(value, rule.min, rule.max) };
      set({ config });
      save(KEYS.config, config);
    },
    patchConfig: (patch) => {
      const config = { ...get().config, ...patch };
      set({ config });
      save(KEYS.config, config);
    },
    setVolume: (volume) => {
      set({ volume });
      save(KEYS.volume, volume);
      try {
        KinesisTimer?.setVolume(volume);
      } catch {
        /* sem módulo nativo */
      }
    },
    setMinutesOnly: (value) => {
      set({ minutesOnly: value });
      save(KEYS.minutesOnly, value);
    },
    preview: (sound) => play(sound),

    start: () => apply(startTimer(get().config, Date.now())),
    stop: () => {
      set({ timer: null });
      save(KEYS.timer, null);
      syncNative(null);
    },
    togglePause: () =>
      withTimer((t, now) => ({ state: t.paused ? resumeTimer(t, now) : pauseTimer(t, now) })),
    exerciseNow: () => withTimer((t, now) => exerciseNow(t, now)),
    snooze: () => {
      const t = get().timer;
      if (!t || snoozesLeft(get().budget) === 0) return;
      withTimer((cur, now) => {
        if (cur.phase !== 'rest') return { state: cur };
        const budget = { ...get().budget, used: get().budget.used + 1 };
        set({ budget });
        save(KEYS.snooze, budget);
        return snoozeTimer(cur, now);
      });
    },
    confirm: () =>
      withTimer((t, now) => {
        if (!isCallPhase(t.phase)) return { state: t };
        logSession(t);
        return confirmTimer(t, now);
      }),
    confirmCircuit: () =>
      withTimer((t, now) => {
        if (!isCallPhase(t.phase)) return { state: t };
        const ids = new Set(t.checkedExercises);
        for (const circuit of activeCircuits(get().circuits, new Date(now))) {
          for (const id of circuit.items) ids.add(id);
        }
        const withAll = { ...t, checkedExercises: Array.from(ids) };
        logSession(withAll);
        return confirmTimer(withAll, now);
      }),
    next: () => withTimer((t, now) => jumpTimer(t, 1, now)),
    prev: () => withTimer((t, now) => prevTimer(t, now)),
    toggleChecked: (id, on) => {
      const t = get().timer;
      if (!t) return;
      const ids = new Set(t.checkedExercises);
      if (on) ids.add(id);
      else ids.delete(id);
      const timer = { ...t, checkedExercises: Array.from(ids) };
      set({ timer });
      save(KEYS.timer, timer);
    },

    addExercise: (name, region) => {
      const id = newId();
      const exercises = [...get().exercises, { id, name, region }];
      set({ exercises });
      save(KEYS.exercises, exercises);
      return id;
    },
    updateExercise: (id, name, region) => {
      const exercises = get().exercises.map((ex) => (ex.id === id ? { ...ex, name, region } : ex));
      // Um circuito treina um grupo só: exercício que mudou de grupo sai dele.
      const circuits = get()
        .circuits.map((c) =>
          c.region && c.region !== region && c.items.includes(id)
            ? { ...c, items: c.items.filter((item) => item !== id) }
            : c,
        )
        .filter((c) => c.items.length > 0);
      set({ exercises, circuits });
      save(KEYS.exercises, exercises);
      save(KEYS.circuits, circuits);
    },
    deleteExercise: (id) => {
      const exercises = get().exercises.filter((ex) => ex.id !== id);
      const circuits = pruneCircuits(exercises, get().circuits);
      set({ exercises, circuits });
      save(KEYS.exercises, exercises);
      save(KEYS.circuits, circuits);
    },
    saveCircuit: (id, data) => {
      const circuits = id
        ? get().circuits.map((c) => (c.id === id ? { ...c, ...data } : c))
        : [...get().circuits, { id: newId(), ...data }];
      set({ circuits });
      save(KEYS.circuits, circuits);
    },
    deleteCircuit: (id) => {
      const circuits = get().circuits.filter((c) => c.id !== id);
      set({ circuits });
      save(KEYS.circuits, circuits);
    },
    savePreset: (name) => {
      const c = get().config;
      const presets = [{ id: newId(), name, ...c }, ...get().presets];
      set({ presets });
      save(KEYS.presets, presets);
    },
    loadPreset: (preset) => {
      const c = get().config;
      const config: KinesisConfig = {
        ...c,
        sets: preset.sets,
        prepare: preset.prepare,
        work: preset.work,
        rest: preset.rest,
        workSound: preset.workSound || c.workSound,
        restSound: preset.restSound || c.restSound,
        alertSound: preset.alertSound || c.alertSound,
        alertEvery: preset.alertEvery || c.alertEvery,
        snoozeMinutes: preset.snoozeMinutes || c.snoozeMinutes,
        preExercisePercent: preset.preExercisePercent ?? c.preExercisePercent,
        preExerciseCount: preset.preExerciseCount ?? c.preExerciseCount,
        preExerciseSound: preset.preExerciseSound || c.preExerciseSound,
      };
      set({ config });
      save(KEYS.config, config);
    },
    deletePreset: (id) => {
      const presets = get().presets.filter((p) => p.id !== id);
      set({ presets });
      save(KEYS.presets, presets);
    },

    exportData: () => {
      const { config, presets, exercises, circuits, history, budget, volume, minutesOnly } = get();
      return { config, presets, exercises, circuits, history, snooze: budget, volume, minutesOnly };
    },
    importData: (data) => {
      const s = get();
      const next = {
        config: { ...s.config, ...data.config },
        presets: Array.isArray(data.presets) ? data.presets : s.presets,
        exercises: Array.isArray(data.exercises) ? data.exercises : s.exercises,
        circuits: Array.isArray(data.circuits) ? data.circuits : s.circuits,
        history: Array.isArray(data.history) ? data.history : s.history,
        budget: data.snooze ?? s.budget,
        volume: typeof data.volume === 'number' ? data.volume : s.volume,
        minutesOnly: typeof data.minutesOnly === 'boolean' ? data.minutesOnly : s.minutesOnly,
      };
      set(next);
      save(KEYS.config, next.config);
      save(KEYS.presets, next.presets);
      save(KEYS.exercises, next.exercises);
      save(KEYS.circuits, next.circuits);
      save(KEYS.history, next.history);
      save(KEYS.snooze, next.budget);
      save(KEYS.volume, next.volume);
      save(KEYS.minutesOnly, next.minutesOnly);
      try {
        KinesisTimer?.setVolume(next.volume);
      } catch {
        /* sem módulo nativo */
      }
    },
  };
});

let started = false;

/** Sobe o Kinesis uma vez. Nunca lança: uma falha aqui não pode derrubar a Comentora. */
export async function startKinesis(): Promise<void> {
  if (started) return;
  started = true;
  try {
    await Font.loadAsync({
      GFSNeohellenic_400: require('../../assets/kinesis/GFSNeohellenic-Regular.ttf'),
      GFSNeohellenic_700: require('../../assets/kinesis/GFSNeohellenic-Bold.ttf'),
    }).catch((err) => console.warn('[kinesis] fonte não carregou:', err));
    await useKinesis.getState().load();
    AppState.addEventListener('change', (s) => {
      if (s === 'active') useKinesis.getState().tick();
    });
  } catch (err) {
    console.warn('[kinesis] init falhou:', err);
  }
}
