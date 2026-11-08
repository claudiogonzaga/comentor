// As configurações do Áskesis entre o telefone e o Mac.
//
// Um único arquivo JSON na pasta Askesis do Google Drive. O telefone o lê e grava
// pela API (escopo drive.file) e é sempre ele quem o CRIA: com esse escopo, só
// enxerga o que ele mesmo criou. O Mac o regrava no espelho local do Google Drive
// para Desktop, sem trocar o arquivo, o que mantém o id.
//
// Cada chave vale por si: { t: epoch ms, by: aparelho, v: valor }, e ganha a
// alteração mais recente. O que mudou aqui é detectado comparando com o hash do
// que foi visto na última passada, sem gancho em cada tela. As regras são as mesmas
// de sync.py, no projeto do Mac. As chaves de API NÃO passam por aqui. Cada tarefa
// do Kairós é uma chave; apagada, vira null por 30 dias, para o outro lado apagar.
// Cada card ocultado no feed do Escudo também é uma chave (aspis.oculto.*), com regras
// próprias de validade (ocultoSync.ts).
//
// Limite conhecido: com o app fechado o JS não roda. Uma tarefa marcada no Mac só
// cala as cobranças do telefone quando o Áskesis volta a abrir aqui.

import { AppState } from 'react-native';

import { getAccessToken, NotSignedInError } from '../aspis/services/auth';
import {
  createJsonFile,
  ensureFolder,
  findFile,
  readJsonFile,
  updateJsonFile,
} from '../aspis/services/drive';
import { DEFAULT_PILLARS, DEFAULT_RULES, DEFAULT_MIN_STARS, DEFAULT_PERIOD } from '../aspis/constants/defaults';
import * as aspisDb from '../aspis/services/db';
import { thumbsChanged } from '../aspis/services/neural';
import { useAppStore as useAspisStore } from '../aspis/store/useAppStore';
import type { ThumbRecord } from '../aspis/types';
import { mergeTarefa, type Tarefa } from '../kairos/rules';
import { useKairos } from '../kairos/store';
import { DEFAULT_CONFIG } from '../kinesis/timer';
import { SEED_EXERCISES, useKinesis } from '../kinesis/store';
import { useAppStore } from '../store/useAppStore';
import type { Medication, UserConfig } from '../types';
import { rescheduleAllNotifications } from './coach';
import {
  createMedication,
  deleteMedication,
  getDoneNudgeTypes,
  getKV,
  getUserConfig,
  listMedications,
  setKV,
  updateMedication,
  updateUserConfig,
} from './database';
import { confirmMedication, resetMedicationToday, skipMedicationToday } from './medications';
import { confirmNudge, resetNudgeToday, restNudgeToday, skipNudgeToday } from './nudges';
import {
  addSlipRow,
  deleteHabitRow,
  getHabitRow,
  getValuesBetween,
  insertHabitRow,
  listHabitRows,
  listSlipRows,
  listSrbaiRows,
  setValueRow,
  updateHabitRow,
} from './habitDb';
import { statsFor } from './habitStage';
import { markHabit, recordSrbai } from './habitos';
import { logicalDay } from './habitEvents';
import type { HabitDef } from '../types/habits';
import { getEffectiveQuietPeriods } from './quietHours';
import { OCULTO_DROP_MS, OCULTO_KEEP_MS, OCULTO_PREFIX, chavesOcultas, syncOculto } from './ocultoSync';
import { onLocalChange } from './syncBus';

const FOLDER_NAME = 'Askesis';
const FILE_NAME = 'askesis-sync.json';
const STATE_KEY = 'config_sync_state_v1';
const DEVICE = 'phone';
const DONE_PREFIX = 'done:';
const CONFIG_PREFIX = 'comentora.config.';
const KAIROS_PREFIX = 'kairos.task.';
const DONE_KEEP_DAYS = 3;
// App de hábitos (v1.130): a definição de cada hábito (os dois lados editam), as
// estatísticas (só o celular publica: ele tem o histórico inteiro), a quantidade
// do dia, as 4 respostas do SRBAI e os deslizes/vontades.
const HABITO_PREFIX = 'comentora.habito.';
const HABSTATS_PREFIX = 'comentora.habstats.';
const QTY_PREFIX = 'qty:';
const SRBAI_PREFIX = 'srbai:';
const SLIP_PREFIX = 'slip:';
const LONG_KEEP_DAYS = 30;
const TOMBSTONE_KEEP_MS = 30 * 24 * 3600 * 1000;
const POLL_MS = 60_000;
const DEBOUNCE_MS = 4000;

/** Volume, modo silencioso e afins são de cada aparelho: ficam de fora. */
const CONFIG_FIELDS: (keyof UserConfig)[] = [
  'name',
  'bedtime',
  'reminderIntervalMinutes',
  'snoozeMinutes',
  'maxReminders',
  'tone',
  'systemPrompt',
  'geminiModel',
  'aiProvider',
  'claudeModel',
  'claudeEffort',
  'voiceProvider',
  'geminiVoiceName',
  'geminiTtsModel',
  'owlSpecies',
  'owlPauseSeconds',
  'nudgeMaxInsistences',
  'inspirationModeEnabled',
  'inspirationPerDay',
  'notificationsPerDay',
  'sleepAwarenessEnabled',
  'voiceModeEnabled',
  'voiceNudgesEnabled',
  'spokenNudgesEnabled',
  'spokenHeadphonesOnly',
];

interface SyncItem {
  t: number;
  by: string;
  v: unknown;
}

interface SyncDoc {
  v: number;
  updated?: number;
  by?: string;
  items: Record<string, SyncItem>;
}

interface SyncState {
  fileId: string | null;
  hash: Record<string, string>;
  t: Record<string, number>;
  firstDone: boolean;
  /** Tarefas do Kairós: a última versão que os dois lados viram, para juntar em três vias. */
  base?: Record<string, unknown>;
}

export interface ConfigSyncStatus {
  state: 'idle' | 'ok' | 'signed-out' | 'error';
  last: number;
  message: string;
}

let status: ConfigSyncStatus = { state: 'idle', last: 0, message: '' };

export function getConfigSyncStatus(): ConfigSyncStatus {
  return status;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

function hashOf(value: unknown): string {
  const text = stableStringify(value);
  let a = 2166136261;
  let b = 5381;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 16777619);
    b = Math.imul(b, 33) + c;
  }
  return `${(a >>> 0).toString(36)}${(b >>> 0).toString(36)}:${text.length}`;
}

function same(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

function dayKeyOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function recentDays(): string[] {
  const out: string[] = [];
  for (let i = 0; i < DONE_KEEP_DAYS; i += 1) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    out.push(dayKeyOf(d));
  }
  return out;
}

/**
 * As marcas de um dia em nudge_completions, no formato do arquivo: tarefa → estado
 * ('done' | 'min' | 'folga' | 'skip' | 'missed').
 */
function marksOf(keys: string[]): Record<string, string> {
  const set = new Set(keys);
  const bases = new Set<string>();
  for (const raw of keys) {
    const m = /^(.*):(missed|skip|min|folga)$/.exec(raw);
    bases.add(m ? m[1] : raw);
  }
  const out: Record<string, string> = {};
  for (const base of bases) {
    if (set.has(base)) out[base] = set.has(`${base}:min`) ? 'min' : 'done';
    else if (set.has(`${base}:folga`)) out[base] = 'folga';
    else if (set.has(`${base}:skip`)) out[base] = 'skip';
    else if (set.has(`${base}:missed`)) out[base] = 'missed';
  }
  return out;
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return dayKeyOf(d);
}

/** Valor ainda de fábrica não vale como escolha: não pode passar por cima do que o Mac tem. */
function isKinesisDefault(key: string, value: unknown): boolean {
  switch (key) {
    case 'kinesis.config':
      return same(value, DEFAULT_CONFIG);
    case 'kinesis.exercises': {
      const list = value as { name: string; region: string }[];
      return same(
        list.map((e) => [e.name, e.region]),
        SEED_EXERCISES.map((e) => [e.name, e.region]),
      );
    }
    case 'kinesis.presets':
    case 'kinesis.circuits':
    case 'kinesis.history':
      return (value as unknown[]).length === 0;
    case 'kinesis.snooze': {
      const b = value as { used: number; clean: number };
      return b.used === 0 && b.clean === 0;
    }
    case 'kinesis.minutesOnly':
      return value === true;
    default:
      return false;
  }
}

function isAspisDefault(key: string, value: unknown): boolean {
  switch (key) {
    case 'aspis.pillars':
      return same(value, DEFAULT_PILLARS);
    case 'aspis.rules':
      return value === DEFAULT_RULES;
    case 'aspis.minStars':
      return value === DEFAULT_MIN_STARS;
    case 'aspis.period':
      return value === DEFAULT_PERIOD;
    default:
      return false;
  }
}

/** O que este telefone tem agora, por chave do arquivo, e se as tarefas e os ocultos puderam ser lidos. */
async function collect(
  state: SyncState,
): Promise<{ local: Record<string, unknown>; kairosOk: boolean; ocultoOk: boolean }> {
  const local: Record<string, unknown> = {};

  const k = useKinesis.getState();
  if (k.loaded) {
    const kin: Record<string, unknown> = {
      'kinesis.config': k.config,
      'kinesis.presets': k.presets,
      'kinesis.exercises': k.exercises,
      'kinesis.circuits': k.circuits,
      'kinesis.history': k.history,
      'kinesis.snooze': k.budget,
      'kinesis.minutesOnly': k.minutesOnly,
    };
    for (const [key, value] of Object.entries(kin)) {
      if (state.hash[key] !== undefined || !isKinesisDefault(key, value)) local[key] = value;
    }
  }

  const a = useAspisStore.getState();
  if (a.ready) {
    const aspis: Record<string, unknown> = {
      'aspis.pillars': a.pillars,
      'aspis.rules': a.rules,
      'aspis.minStars': a.minStars,
      'aspis.period': a.period,
    };
    for (const [key, value] of Object.entries(aspis)) {
      if (state.hash[key] !== undefined || !isAspisDefault(key, value)) local[key] = value;
    }
    const thumbs = aspisDb.getThumbs();
    if (thumbs.length || state.hash['aspis.thumbs'] !== undefined) local['aspis.thumbs'] = thumbs;
  }

  // Os cards ocultados no Escudo: uma chave por card, só os que mudaram nos últimos 60
  // dias. Sem conseguir ler o banco, a família fica de fora (o vazio aplicaria o de lá
  // por cima de um "desfazer" daqui).
  let ocultoOk = true;
  try {
    aspisDb.pruneHidden(Date.now() - OCULTO_DROP_MS);
    Object.assign(local, chavesOcultas(aspisDb.hiddenChanges(Date.now() - OCULTO_KEEP_MS)));
  } catch (err) {
    console.warn('[configSync] ocultos', err);
    ocultoOk = false;
  }

  const config = await getUserConfig();
  // Campo a campo: mudar o tom lá não desfaz uma mudança de horário aqui.
  for (const field of CONFIG_FIELDS) {
    const value = config[field];
    if (value !== undefined) local[`${CONFIG_PREFIX}${field}`] = value;
  }

  // Os HÁBITOS: uma chave por hábito (a que sumiu daqui vira null), e as
  // estatísticas que o Mac só mostra. Sem conseguir ler, a família fica de fora.
  try {
    const habits = await listHabitRows(true);
    for (const h of habits) {
      const { id: _id, ...def } = h;
      local[`${HABITO_PREFIX}${h.type}`] = def;
      try {
        const st = await statsFor(h);
        local[`${HABSTATS_PREFIX}${h.type}`] = {
          strength: Math.round(st.strength * 1000) / 1000,
          stage: st.stage,
          formed: st.formed,
          last30: [st.last30.done, st.last30.total],
          streak: st.streak,
          best: st.best,
          total: st.total,
          heat: st.heat,
          srbai: st.srbai,
          srbaiDue: st.srbaiDue,
          weekDone: st.weekDone,
          cleanDays: st.cleanDays,
        };
      } catch (err) {
        console.warn('[configSync] habstats', h.type, err);
      }
    }
    for (const key of Object.keys(state.hash)) {
      if ((key.startsWith(HABITO_PREFIX) || key.startsWith(HABSTATS_PREFIX)) && !(key in local)) local[key] = null;
    }
    // Quantidades dos últimos dias; a que foi apagada vira null.
    for (const v of await getValuesBetween(daysAgo(DONE_KEEP_DAYS - 1), daysAgo(0))) {
      local[`${QTY_PREFIX}${v.date}:${v.key}`] = v.value;
    }
    for (const key of Object.keys(state.hash)) {
      if (key.startsWith(QTY_PREFIX) && !(key in local)) local[key] = null;
    }
    // SRBAI (só as respostas completas, de 4 itens) e deslizes dos últimos 30 dias.
    for (const e of await listSrbaiRows(null, daysAgo(LONG_KEEP_DAYS - 1))) {
      if (e.items.length === 4) local[`${SRBAI_PREFIX}${e.key}:${e.date}`] = e.items;
    }
    for (const sl of await listSlipRows(null, `${daysAgo(LONG_KEEP_DAYS - 1)}T00:00:00`)) {
      const ms = Date.parse(sl.at);
      if (Number.isFinite(ms)) {
        local[`${SLIP_PREFIX}${sl.key}:${ms}`] = {
          place: sl.place,
          emotion: sl.emotion,
          trigger: sl.trigger,
          note: sl.note,
          resisted: sl.resisted,
        };
      }
    }
  } catch (err) {
    console.warn('[configSync] hábitos', err);
  }
  local['comentora.meds'] = (await listMedications()).map((m) => ({
    id: m.id,
    name: m.name,
    dosage: m.dosage,
    time: m.time,
    emoji: m.emoji,
    enabled: m.enabled,
    daysOfWeek: m.daysOfWeek,
    fastingHours: m.fastingHours ?? null,
    strict: m.strict,
  }));
  // Inclui o sono derivado do horário de dormir. No Mac é só leitura.
  local['comentora.quiet'] = await getEffectiveQuietPeriods().catch(() => []);

  // Uma chave por tarefa. Marca desfeita vira null, senão a do Mac voltaria.
  for (const day of recentDays()) {
    const marks = marksOf(await getDoneNudgeTypes(day).catch(() => []));
    for (const [task, value] of Object.entries(marks)) {
      local[`${DONE_PREFIX}${day}:${task}`] = value;
    }
  }
  for (const key of Object.keys(state.hash)) {
    if (key.startsWith(DONE_PREFIX) && !(key in local)) local[key] = null;
  }

  // Uma chave por tarefa. A que sumiu daqui vira null, para sumir no Mac também.
  // Sem conseguir ler as tarefas, a família fica de fora: o vazio apagaria tudo.
  await useKairos.getState().load();
  const kairos = useKairos.getState();
  if (!kairos.loaded) return { local, kairosOk: false, ocultoOk };
  for (const t of kairos.tarefas) local[`${KAIROS_PREFIX}${t.id}`] = t;
  for (const key of Object.keys(state.hash)) {
    if (key.startsWith(KAIROS_PREFIX) && !(key in local)) local[key] = null;
  }
  return { local, kairosOk: true, ocultoOk };
}

async function applyMeds(remote: (Partial<Medication> & { id?: number | null })[]): Promise<void> {
  const current = await listMedications();
  const byId = new Map(current.map((m) => [m.id, m]));
  const keep = new Set<number>();
  for (const r of remote) {
    const fields = {
      name: r.name ?? '',
      dosage: r.dosage ?? null,
      time: r.time ?? '08:00',
      emoji: r.emoji ?? null,
      enabled: r.enabled !== false,
      daysOfWeek: r.daysOfWeek ?? [0, 1, 2, 3, 4, 5, 6],
      fastingHours: r.fastingHours ?? null,
      // Rigoroso: só um booleano muda; ausente (um Mac antigo) mantém o do telefone.
      ...(typeof r.strict === 'boolean' ? { strict: r.strict } : {}),
    };
    if (typeof r.id === 'number' && byId.has(r.id)) {
      keep.add(r.id);
      await updateMedication(r.id, fields);
    } else {
      // Criado no Mac: quem numera é o telefone.
      const created = await createMedication(fields);
      keep.add(created.id);
    }
  }
  for (const m of current) {
    if (!keep.has(m.id)) await deleteMedication(m.id);
  }
}

async function applyDone(key: string, value: unknown): Promise<void> {
  const rest = key.slice(DONE_PREFIX.length);
  const cut = rest.indexOf(':');
  const day = rest.slice(0, cut);
  const task = rest.slice(cut + 1);
  const today = dayKeyOf(new Date());
  const meta = { via: 'mac' as const, day };
  if (task.startsWith('med:')) {
    const id = Number(task.slice(4));
    if (!Number.isFinite(id)) return;
    if (value === 'done') await confirmMedication(id, meta);
    else if (value === 'skip') await skipMedicationToday(id, meta);
    else if (value === null && day === today) await resetMedicationToday(id);
    return;
  }
  // Dia mais antigo que ontem (correção feita no Mac): grava direto no dia certo.
  if (logicalDay(day) !== day) {
    if (!(await getHabitRow(task))) return;
    if (value === 'done' || value === 'min') await markHabit(task, value === 'min' ? 'minimo' : 'feito', { day, via: 'mac' });
    else if (value === 'folga') await markHabit(task, 'folga', { day, via: 'mac' });
    else if (value === 'skip') await markHabit(task, 'nao', { day, via: 'mac' });
    return;
  }
  if (value === 'done') {
    await confirmNudge(task, meta);
  } else if (value === 'min') {
    await confirmNudge(task, meta, { minimum: true });
  } else if (value === 'folga') {
    await restNudgeToday(task, meta);
  } else if (value === 'skip') {
    await skipNudgeToday(task, meta);
  } else if (value === null && day === today) {
    await resetNudgeToday(task);
  }
}

/** Campos de um hábito vindos do Mac (só os conhecidos, com o tipo certo). */
function habitFields(v: Record<string, unknown>): Partial<HabitDef> {
  const out: Partial<HabitDef> = {};
  const str = (k: keyof HabitDef) => {
    if (typeof v[k] === 'string') (out as Record<string, unknown>)[k] = v[k];
  };
  const strOrNull = (k: keyof HabitDef) => {
    if (typeof v[k] === 'string' || v[k] === null) (out as Record<string, unknown>)[k] = v[k];
  };
  const bool = (k: keyof HabitDef) => {
    if (typeof v[k] === 'boolean') (out as Record<string, unknown>)[k] = v[k];
  };
  const num = (k: keyof HabitDef) => {
    if (typeof v[k] === 'number' || v[k] === null) (out as Record<string, unknown>)[k] = v[k];
  };
  str('title');
  str('body');
  strOrNull('emoji');
  bool('enabled');
  str('scheduleTime');
  num('orderIndex');
  bool('strict');
  str('kind');
  strOrNull('cue');
  strOrNull('place');
  strOrNull('minimum');
  strOrNull('planB');
  strOrNull('why');
  str('measure');
  num('target');
  strOrNull('unit');
  str('freq');
  if (Array.isArray(v.daysOfWeek)) out.daysOfWeek = (v.daysOfWeek as unknown[]).filter((x): x is number => typeof x === 'number');
  num('perWeek');
  str('reminders');
  strOrNull('action');
  strOrNull('pausedUntil');
  if (Array.isArray(v.pauses)) out.pauses = v.pauses as [string, string][];
  bool('archived');
  str('createdDay');
  return out;
}

async function applyHabitDef(type: string, value: unknown): Promise<void> {
  const existing = await getHabitRow(type);
  if (value === null || typeof value !== 'object') {
    if (existing) await deleteHabitRow(type);
    return;
  }
  const fields = habitFields(value as Record<string, unknown>);
  if (existing) await updateHabitRow(type, fields);
  else if (fields.title) await insertHabitRow(type, { ...fields, title: fields.title });
}

interface Effects {
  reschedule: boolean;
  refreshConfig: boolean;
  /** Um card do Escudo foi ocultado ou voltou: o feed relê o banco. */
  feed?: boolean;
}

async function applyItem(key: string, value: unknown, fx: Effects): Promise<void> {
  if (key.startsWith(DONE_PREFIX)) {
    await applyDone(key, value);
  } else if (key.startsWith(CONFIG_PREFIX)) {
    await updateUserConfig({ [key.slice(CONFIG_PREFIX.length)]: value } as Partial<UserConfig>);
    fx.refreshConfig = true;
    fx.reschedule = true;
  } else if (key.startsWith(HABITO_PREFIX)) {
    await applyHabitDef(key.slice(HABITO_PREFIX.length), value);
    fx.reschedule = true;
  } else if (key.startsWith(HABSTATS_PREFIX)) {
    // Só o celular publica as estatísticas (ele tem o histórico inteiro).
  } else if (key.startsWith(QTY_PREFIX)) {
    const rest = key.slice(QTY_PREFIX.length);
    const day = rest.slice(0, 10);
    const type = rest.slice(11);
    if (await getHabitRow(type)) await setValueRow(type, day, typeof value === 'number' ? value : null);
  } else if (key.startsWith(SRBAI_PREFIX)) {
    const rest = key.slice(SRBAI_PREFIX.length);
    const cut = rest.lastIndexOf(':');
    const items = Array.isArray(value) ? (value as unknown[]).filter((x): x is number => typeof x === 'number') : [];
    if (cut > 0 && items.length === 4) {
      await recordSrbai(rest.slice(0, cut), items as [number, number, number, number], rest.slice(cut + 1));
    }
  } else if (key.startsWith(SLIP_PREFIX)) {
    const rest = key.slice(SLIP_PREFIX.length);
    const cut = rest.lastIndexOf(':');
    const ms = Number(rest.slice(cut + 1));
    const v = (value ?? {}) as { place?: string | null; emotion?: string | null; trigger?: string | null; note?: string | null; resisted?: boolean };
    if (cut > 0 && Number.isFinite(ms) && value) {
      await addSlipRow({
        key: rest.slice(0, cut),
        at: new Date(ms).toISOString(),
        place: v.place ?? null,
        emotion: v.emotion ?? null,
        trigger: v.trigger ?? null,
        note: v.note ?? null,
        resisted: !!v.resisted,
      });
    }
  } else if (key === 'comentora.meds') {
    await applyMeds(value as Medication[]);
    fx.reschedule = true;
  } else if (key.startsWith(KAIROS_PREFIX)) {
    useKairos.getState().applySynced(key.slice(KAIROS_PREFIX.length), (value ?? null) as Tarefa | null);
  } else if (key.startsWith('kinesis.')) {
    useKinesis.getState().applySynced(key, value);
  } else if (key === 'aspis.pillars') {
    await useAspisStore.getState().setPillars(value as never);
  } else if (key === 'aspis.rules') {
    await useAspisStore.getState().setRules(String(value ?? ''));
  } else if (key === 'aspis.minStars') {
    await useAspisStore.getState().setMinStars(Number(value));
  } else if (key === 'aspis.period') {
    await useAspisStore.getState().setPeriod(value as never);
  }
  // comentora.quiet é publicado daqui; o Mac não o altera.
}

/** O histórico de exercícios só cresce: a união dos dois lados, sem repetir. */
function mergeHistory(a: unknown, b: unknown): { ts: number }[] {
  const seen = new Map<number, { ts: number }>();
  for (const entry of [...((a as { ts: number }[]) ?? []), ...((b as { ts: number }[]) ?? [])]) {
    seen.set(entry.ts, entry);
  }
  return Array.from(seen.values()).sort((x, y) => (x.ts || 0) - (y.ts || 0));
}

function mergeThumbs(a: unknown, b: unknown): ThumbRecord[] {
  const seen = new Map<string, ThumbRecord>();
  for (const t of [...((a as ThumbRecord[]) ?? []), ...((b as ThumbRecord[]) ?? [])]) {
    const cur = seen.get(t.video_id);
    if (!cur || t.updated_at > cur.updated_at) seen.set(t.video_id, t);
  }
  return Array.from(seen.values()).sort((x, y) => x.updated_at - y.updated_at);
}

/** Grava o que veio do outro aparelho e manda a rede rever o que sabe. */
function applyThumbs(list: ThumbRecord[]): void {
  for (const t of list) {
    aspisDb.upsertThumb(t);
    if (t.value === -1) aspisDb.skipVideo(t.video_id);
    else if (aspisDb.hasVideo(t.video_id)) aspisDb.unskipVideo(t.video_id);
  }
  thumbsChanged();
}

/**
 * Uma tarefa do Kairós, de ponta a ponta (a mesma regra de _sync_task, no Mac).
 * Devolve true se o arquivo mudou. Apagada vira null por 30 dias. Mudada dos dois
 * lados, junta em três vias contra a última versão que os dois viram: cada campo fica
 * com o lado que o mudou, e o andamento e as conversas se somam.
 */
async function syncTask(
  key: string,
  local: Record<string, unknown>,
  items: Record<string, SyncItem>,
  remote: SyncItem | undefined,
  state: SyncState,
  first: boolean,
  now: number,
  fx: Effects,
  applied: string[],
): Promise<boolean> {
  const bases = (state.base ??= {});
  const inLocal = key in local;
  const lv = (local[key] ?? null) as Tarefa | null;
  const rv = (remote?.v ?? null) as Tarefa | null;
  const rt = remote?.t ?? 0;
  const lh = inLocal ? hashOf(local[key]) : null;
  const changed = inLocal && lh !== state.hash[key];
  const lt = first ? 0 : changed ? now : (state.t[key] ?? 0);

  if (lv === null && rv === null) {
    let dirty = false;
    if (remote && now - rt > TOMBSTONE_KEEP_MS) {
      delete items[key];
      dirty = true;
    }
    delete state.hash[key];
    delete state.t[key];
    delete bases[key];
    return dirty;
  }
  if (rv === null && (!remote || lt > rt)) {
    // Só daqui, ou mudada aqui depois de ser apagada lá: vai para o arquivo.
    items[key] = { t: lt || now, by: DEVICE, v: lv };
    state.t[key] = lt || now;
    state.hash[key] = lh as string;
    bases[key] = lv;
    return true;
  }
  if (rv === null) {
    // Apagada lá depois da última mudança daqui.
    await applyItem(key, null, fx);
    applied.push(key);
    delete state.hash[key];
    delete bases[key];
    state.t[key] = rt;
    return false;
  }
  if (lv === null) {
    if (inLocal && lt > rt) {
      // Apagada aqui depois da última mudança de lá.
      items[key] = { t: lt, by: DEVICE, v: null };
      state.t[key] = lt;
      state.hash[key] = lh as string;
      delete bases[key];
      return true;
    }
    await applyItem(key, rv, fx);
    applied.push(key);
    state.t[key] = rt;
    bases[key] = rv;
    return false;
  }
  if (lh === hashOf(rv)) {
    state.t[key] = Math.max(lt, rt);
    state.hash[key] = lh as string;
    bases[key] = rv;
    return false;
  }
  const merged = mergeTarefa(bases[key] as Tarefa | undefined, lv, rv, lt > rt);
  let dirty = false;
  if (hashOf(merged) !== lh) {
    await applyItem(key, merged, fx);
    applied.push(key);
  } else {
    state.hash[key] = lh as string;
  }
  if (hashOf(merged) !== hashOf(rv)) {
    items[key] = { t: now, by: DEVICE, v: merged };
    state.t[key] = now;
    dirty = true;
  } else {
    state.t[key] = rt;
  }
  bases[key] = merged;
  return dirty;
}

async function loadState(): Promise<SyncState> {
  try {
    const raw = await getKV(STATE_KEY);
    if (raw) return { fileId: null, hash: {}, t: {}, firstDone: false, ...JSON.parse(raw) };
  } catch {
    /* recomeça */
  }
  return { fileId: null, hash: {}, t: {}, firstDone: false };
}

async function runOnce(): Promise<void> {
  const token = await getAccessToken();
  const state = await loadState();
  const now = Date.now();

  let doc: SyncDoc | null = null;
  if (state.fileId) doc = await readJsonFile<SyncDoc>(token, state.fileId);
  let folderId: string | null = null;
  if (!doc) {
    folderId = await ensureFolder(token, FOLDER_NAME);
    const found = await findFile(token, folderId, FILE_NAME);
    if (found) {
      state.fileId = found;
      doc = await readJsonFile<SyncDoc>(token, found);
    } else {
      state.fileId = null;
    }
  }

  const items: Record<string, SyncItem> = { ...(doc?.items ?? {}) };
  const first = !state.firstDone;
  const { local, kairosOk, ocultoOk } = await collect(state);
  const fx: Effects = { reschedule: false, refreshConfig: false };
  const applied: string[] = [];
  const oldestDay = recentDays()[DONE_KEEP_DAYS - 1];
  let dirty = !doc;

  const oldestLong = daysAgo(LONG_KEEP_DAYS - 1);
  const oldestLongMs = Date.parse(`${oldestLong}T00:00:00`);
  for (const key of Array.from(new Set([...Object.keys(local), ...Object.keys(items)])).sort()) {
    // A lista antiga de hábitos (até a v1.129): agora é uma chave por hábito.
    // Aplicá-la de novo traria valores velhos por cima — sai do arquivo.
    if (key === 'comentora.nudges') {
      if (items[key]) {
        delete items[key];
        dirty = true;
      }
      delete state.hash[key];
      delete state.t[key];
      continue;
    }
    const expired =
      (key.startsWith(QTY_PREFIX) && key.slice(QTY_PREFIX.length, QTY_PREFIX.length + 10) < oldestDay) ||
      (key.startsWith(SRBAI_PREFIX) && key.slice(key.lastIndexOf(':') + 1) < oldestLong) ||
      (key.startsWith(SLIP_PREFIX) && Number(key.slice(key.lastIndexOf(':') + 1)) < oldestLongMs);
    if (expired) {
      if (items[key]) {
        delete items[key];
        dirty = true;
      }
      delete state.hash[key];
      delete state.t[key];
      continue;
    }
    if (key.startsWith(DONE_PREFIX) && key.slice(DONE_PREFIX.length, DONE_PREFIX.length + 10) < oldestDay) {
      if (items[key]) {
        delete items[key];
        dirty = true;
      }
      delete state.hash[key];
      delete state.t[key];
      continue;
    }
    if (key.startsWith(OCULTO_PREFIX)) {
      // Sem conseguir ler os ocultos daqui, a família fica de fora desta passada.
      if (!ocultoOk) continue;
      const passo = syncOculto(
        key,
        key in local ? (local[key] as number | null) : undefined,
        items,
        state,
        first,
        now,
        DEVICE,
        hashOf,
        aspisDb.applyHidden,
      );
      if (passo.dirty) dirty = true;
      if (passo.feed) fx.feed = true;
      continue;
    }

    const remote = items[key];

    if (key.startsWith(KAIROS_PREFIX)) {
      // Sem conseguir ler as tarefas daqui, a família fica de fora desta passada.
      if (!kairosOk) continue;
      if (await syncTask(key, local, items, remote, state, first, now, fx, applied)) dirty = true;
      continue;
    }

    const haveLocal = key in local;
    const lh = haveLocal ? hashOf(local[key]) : null;
    const changed = haveLocal && lh !== state.hash[key];

    // Os 👍/👎 treinam a rede dos dois lados: vale a marcação mais recente de cada vídeo.
    if (key === 'aspis.thumbs') {
      const merged = mergeThumbs(local[key], remote?.v);
      if (hashOf(merged) !== lh) {
        applyThumbs(merged);
        // Muda o que a rede vê: o próximo collect já traz a união.
      }
      if (!remote || hashOf(remote.v) !== hashOf(merged)) {
        items[key] = { t: now, by: DEVICE, v: merged };
        dirty = true;
      }
      state.hash[key] = hashOf(merged);
      state.t[key] = now;
      continue;
    }

    if (key === 'kinesis.history') {
      const merged = mergeHistory(local[key], remote?.v);
      if (!haveLocal || hashOf(merged) !== lh) await applyItem(key, merged, fx);
      if (!remote || hashOf(remote.v) !== hashOf(merged)) {
        items[key] = { t: now, by: DEVICE, v: merged };
        dirty = true;
      }
      state.hash[key] = hashOf(merged);
      state.t[key] = now;
      continue;
    }

    // O instante da versão daqui: agora, se acabou de mudar. No primeiro contato
    // do aparelho (reinstalação), o que está no arquivo manda.
    const rt = remote?.t ?? 0;
    let lt = changed ? now : (state.t[key] ?? 0);
    if (first && remote) lt = 0;

    if (!remote) {
      if (haveLocal) {
        items[key] = { t: lt || now, by: DEVICE, v: local[key] };
        dirty = true;
        state.t[key] = lt || now;
        state.hash[key] = lh as string;
      }
    } else if (!haveLocal || rt > lt) {
      if (!haveLocal || hashOf(remote.v) !== lh) {
        await applyItem(key, remote.v, fx);
        applied.push(key);
      }
      state.t[key] = rt;
    } else {
      // A daqui é a mais nova. Também cura o caso de a gravação do outro lado ter
      // passado por cima desta: ela volta para o arquivo.
      if (lt > rt && hashOf(remote.v) !== lh) {
        items[key] = { t: lt, by: DEVICE, v: local[key] };
        dirty = true;
      }
      state.t[key] = lt;
      state.hash[key] = lh as string;
    }
  }

  if (fx.refreshConfig) await useAppStore.getState().refreshConfig();
  if (fx.feed) useAspisStore.getState().bumpFeed();
  if (fx.reschedule) await rescheduleAllNotifications().catch(() => {});

  // O que acabou de ser aplicado é o novo "visto": a forma daqui, já normalizada.
  if (applied.length) {
    const { local: fresh } = await collect(state);
    for (const key of applied) {
      if (!(key in fresh)) {
        delete state.hash[key];
        continue;
      }
      state.hash[key] = hashOf(fresh[key]);
      // Lembrete criado no Mac ganhou id aqui: o Mac precisa saber qual é.
      if (key === 'comentora.meds' && !same(fresh[key], items[key]?.v)) {
        items[key] = { t: Date.now(), by: DEVICE, v: fresh[key] };
        state.t[key] = items[key].t;
        dirty = true;
      }
    }
  }

  if (dirty) {
    const body = JSON.stringify({ v: 1, updated: Date.now(), by: DEVICE, items });
    if (state.fileId) {
      await updateJsonFile(token, state.fileId, body);
    } else {
      state.fileId = await createJsonFile(
        token,
        folderId ?? (await ensureFolder(token, FOLDER_NAME)),
        FILE_NAME,
        body,
      );
    }
  }
  state.firstDone = true;
  await setKV(STATE_KEY, JSON.stringify(state));
  status = { state: 'ok', last: Date.now(), message: '' };
}

let running: Promise<void> | null = null;
let again = false;

/** Uma passada. Nunca lança. Quem chega no meio garante mais uma, logo depois. */
export function syncConfigNow(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    try {
      await runOnce();
    } catch (err) {
      if (err instanceof NotSignedInError) {
        status = { ...status, state: 'signed-out', message: '' };
      } else {
        const message = err instanceof Error ? err.message : String(err);
        console.warn('[configSync]', message);
        status = { ...status, state: 'error', message };
      }
    }
  })().finally(() => {
    running = null;
    if (again) {
      again = false;
      void syncConfigNow();
    }
  });
  return running;
}

let started = false;

/** Sincroniza ao abrir, ao voltar para o app, a cada minuto e depois de cada mudança. */
export function startConfigSync(): void {
  if (started) return;
  started = true;

  let timer: ReturnType<typeof setTimeout> | null = null;
  const soon = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (AppState.currentState === 'active') void syncConfigNow();
    }, DEBOUNCE_MS);
  };

  onLocalChange(soon);
  useAppStore.subscribe((now, before) => {
    if (now.config !== before.config) soon();
  });
  useKinesis.subscribe((now, before) => {
    if (
      now.loaded !== before.loaded ||
      now.config !== before.config ||
      now.presets !== before.presets ||
      now.exercises !== before.exercises ||
      now.circuits !== before.circuits ||
      now.history !== before.history ||
      now.budget !== before.budget ||
      now.minutesOnly !== before.minutesOnly
    ) {
      soon();
    }
  });
  useKairos.subscribe((now, before) => {
    if (now.loaded !== before.loaded || now.tarefas !== before.tarefas) soon();
  });
  useAspisStore.subscribe((now, before) => {
    if (
      now.ready !== before.ready ||
      now.user !== before.user ||
      now.pillars !== before.pillars ||
      now.rules !== before.rules ||
      now.minStars !== before.minStars ||
      now.period !== before.period
    ) {
      soon();
    }
  });
  AppState.addEventListener('change', (s) => {
    if (s === 'active') void syncConfigNow();
  });
  setInterval(() => {
    if (AppState.currentState === 'active') void syncConfigNow();
  }, POLL_MS);
  soon();
}
