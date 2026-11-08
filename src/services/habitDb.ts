// A camada de dados do APP DE HÁBITOS (v1.130).
//
// O hábito é uma linha de `nudges` com as colunas novas (pista, versão mínima,
// plano B, frequência, modo dos avisos, pausa…). O registro do dia segue em
// `nudge_completions`; a quantidade vai em `habit_values`; deslizes e vontades
// superadas em `habit_slips`; as 4 respostas do SRBAI em `automaticity` (q1..q4).
//
// O esquema é garantido de forma preguiçosa (ensureHabitSchema), antes de
// qualquer leitura daqui — as linhas antigas ganham os padrões de um hábito
// diário, de fazer, com avisos automáticos.

import { format } from 'date-fns';
import { getDb } from './database';
import type { HabitAction, HabitDef, HabitFreq, HabitKind, HabitMeasure, HabitReminders, HabitSlip, SrbaiEntry } from '../types/habits';

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

let schemaReady: Promise<void> | null = null;

/** Colunas novas de `nudges` (nome → definição). */
const NUDGE_COLUMNS: [string, string][] = [
  ['kind', "TEXT NOT NULL DEFAULT 'fazer'"],
  ['cue', 'TEXT'],
  ['place', 'TEXT'],
  ['minimum', 'TEXT'],
  ['plan_b', 'TEXT'],
  ['why', 'TEXT'],
  ['measure', "TEXT NOT NULL DEFAULT 'sim'"],
  ['target', 'REAL'],
  ['unit', 'TEXT'],
  ['freq', "TEXT NOT NULL DEFAULT 'diario'"],
  ['days_of_week', "TEXT NOT NULL DEFAULT '0,1,2,3,4,5,6'"],
  ['per_week', 'INTEGER'],
  ['reminders', "TEXT NOT NULL DEFAULT 'auto'"],
  ['action', 'TEXT'],
  ['paused_until', 'TEXT'],
  ['pauses', "TEXT NOT NULL DEFAULT '[]'"],
  ['archived', 'INTEGER NOT NULL DEFAULT 0'],
  ['created_day', 'TEXT'],
];

export function ensureHabitSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      const d = await getDb();
      const cols = await d.getAllAsync<{ name: string }>("PRAGMA table_info('nudges')");
      const have = new Set(cols.map((c) => c.name));
      for (const [name, def] of NUDGE_COLUMNS) {
        if (!have.has(name)) await d.execAsync(`ALTER TABLE nudges ADD COLUMN ${name} ${def}`);
      }
      await d.execAsync(`
        CREATE TABLE IF NOT EXISTS habit_values (
          key TEXT NOT NULL,
          date TEXT NOT NULL,
          value REAL NOT NULL,
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (key, date)
        );
        CREATE TABLE IF NOT EXISTS habit_slips (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          key TEXT NOT NULL,
          at TEXT NOT NULL,
          place TEXT,
          emotion TEXT,
          trigger TEXT,
          note TEXT,
          resisted INTEGER NOT NULL DEFAULT 0,
          UNIQUE (key, at)
        );
        CREATE INDEX IF NOT EXISTS idx_habit_slips_key ON habit_slips(key, at);
      `);
      const autoCols = await d.getAllAsync<{ name: string }>("PRAGMA table_info('automaticity')");
      const haveAuto = new Set(autoCols.map((c) => c.name));
      for (const q of ['q1', 'q2', 'q3', 'q4']) {
        if (!haveAuto.has(q)) await d.execAsync(`ALTER TABLE automaticity ADD COLUMN ${q} INTEGER`);
      }
      // Primeiro dia de cada hábito antigo: o registro mais antigo dele, ou a criação.
      const missing = await d.getAllAsync<{ type: string; created_at: string }>(
        'SELECT type, created_at FROM nudges WHERE created_day IS NULL',
      );
      for (const m of missing) {
        const first = await d.getFirstAsync<{ first: string | null }>(
          `SELECT MIN(date) AS first FROM nudge_completions WHERE nudge_type = ? OR nudge_type LIKE ?`,
          [m.type, `${m.type}:%`],
        );
        const created = (m.created_at ?? '').slice(0, 10) || format(new Date(), 'yyyy-MM-dd');
        const day = first?.first && first.first < created ? first.first : created;
        await d.runAsync('UPDATE nudges SET created_day = ? WHERE type = ?', [day, m.type]);
      }
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

// ————————————————— hábitos —————————————————

interface HabitRow {
  id: number;
  type: string;
  title: string;
  body: string;
  emoji: string | null;
  enabled: number;
  schedule_time: string;
  order_index: number;
  strict_mode: number | null;
  kind: string | null;
  cue: string | null;
  place: string | null;
  minimum: string | null;
  plan_b: string | null;
  why: string | null;
  measure: string | null;
  target: number | null;
  unit: string | null;
  freq: string | null;
  days_of_week: string | null;
  per_week: number | null;
  reminders: string | null;
  action: string | null;
  paused_until: string | null;
  pauses: string | null;
  archived: number | null;
  created_day: string | null;
}

function parseDays(raw: string | null): number[] {
  if (!raw) return [...ALL_DAYS];
  const out = raw
    .split(',')
    .map((x) => parseInt(x, 10))
    .filter((n) => Number.isFinite(n) && n >= 0 && n <= 6);
  return out.length ? Array.from(new Set(out)).sort() : [...ALL_DAYS];
}

function parsePauses(raw: string | null): [string, string][] {
  try {
    const v = JSON.parse(raw ?? '[]');
    return Array.isArray(v)
      ? v.filter((p) => Array.isArray(p) && typeof p[0] === 'string' && typeof p[1] === 'string').map((p) => [p[0], p[1]] as [string, string])
      : [];
  } catch {
    return [];
  }
}

const KINDS: HabitKind[] = ['fazer', 'parar'];
const MEASURES: HabitMeasure[] = ['sim', 'quantidade'];
const FREQS: HabitFreq[] = ['diario', 'dias', 'semana'];
const REMINDERS: HabitReminders[] = ['auto', 'completo', 'hora', 'nenhum'];
const ACTIONS: HabitAction[] = ['respiracao', 'ioga', 'leia', 'zazen'];

function pick<T extends string>(v: string | null | undefined, allowed: T[], fallback: T): T {
  return allowed.includes(v as T) ? (v as T) : fallback;
}

export function rowToHabit(r: HabitRow): HabitDef {
  return {
    id: r.id,
    type: r.type,
    title: r.title,
    body: r.body ?? '',
    emoji: r.emoji,
    enabled: r.enabled === 1,
    scheduleTime: r.schedule_time,
    orderIndex: r.order_index,
    strict: (r.strict_mode ?? 0) === 1,
    kind: pick(r.kind, KINDS, 'fazer'),
    cue: r.cue?.trim() || null,
    place: r.place?.trim() || null,
    minimum: r.minimum?.trim() || null,
    planB: r.plan_b?.trim() || null,
    why: r.why?.trim() || null,
    measure: pick(r.measure, MEASURES, 'sim'),
    target: r.target ?? null,
    unit: r.unit?.trim() || null,
    freq: pick(r.freq, FREQS, 'diario'),
    daysOfWeek: parseDays(r.days_of_week),
    perWeek: r.per_week ?? null,
    reminders: pick(r.reminders, REMINDERS, 'auto'),
    action: (ACTIONS as string[]).includes(r.action ?? '') ? (r.action as HabitAction) : null,
    pausedUntil: r.paused_until || null,
    pauses: parsePauses(r.pauses),
    archived: (r.archived ?? 0) === 1,
    createdDay: r.created_day || format(new Date(), 'yyyy-MM-dd'),
  };
}

export async function listHabitRows(includeArchived = false): Promise<HabitDef[]> {
  await ensureHabitSchema();
  const d = await getDb();
  const rows = await d.getAllAsync<HabitRow>(
    `SELECT * FROM nudges ${includeArchived ? '' : 'WHERE COALESCE(archived, 0) = 0'} ORDER BY order_index ASC, id ASC`,
  );
  return rows.map(rowToHabit);
}

export async function getHabitRow(type: string): Promise<HabitDef | null> {
  await ensureHabitSchema();
  const d = await getDb();
  const row = await d.getFirstAsync<HabitRow>('SELECT * FROM nudges WHERE type = ?', [type]);
  return row ? rowToHabit(row) : null;
}

/** Campos editáveis → coluna e serialização. */
const FIELD_COLUMNS: Record<string, [string, (v: unknown) => string | number | null]> = {
  title: ['title', (v) => String(v ?? '').trim()],
  body: ['body', (v) => String(v ?? '').trim()],
  emoji: ['emoji', (v) => (v ? String(v) : null)],
  enabled: ['enabled', (v) => (v ? 1 : 0)],
  scheduleTime: ['schedule_time', (v) => String(v ?? '08:00')],
  orderIndex: ['order_index', (v) => Number(v) || 0],
  strict: ['strict_mode', (v) => (v ? 1 : 0)],
  kind: ['kind', (v) => pick(v as string, KINDS, 'fazer')],
  cue: ['cue', (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)],
  place: ['place', (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)],
  minimum: ['minimum', (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)],
  planB: ['plan_b', (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)],
  why: ['why', (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)],
  measure: ['measure', (v) => pick(v as string, MEASURES, 'sim')],
  target: ['target', (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null)],
  unit: ['unit', (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)],
  freq: ['freq', (v) => pick(v as string, FREQS, 'diario')],
  daysOfWeek: [
    'days_of_week',
    (v) => (Array.isArray(v) && v.length ? Array.from(new Set(v as number[])).sort().join(',') : ALL_DAYS.join(',')),
  ],
  perWeek: ['per_week', (v) => (typeof v === 'number' && v >= 1 && v <= 7 ? Math.round(v) : null)],
  reminders: ['reminders', (v) => pick(v as string, REMINDERS, 'auto')],
  action: ['action', (v) => ((ACTIONS as string[]).includes(v as string) ? (v as string) : null)],
  pausedUntil: ['paused_until', (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)],
  pauses: ['pauses', (v) => JSON.stringify(Array.isArray(v) ? v : [])],
  archived: ['archived', (v) => (v ? 1 : 0)],
  createdDay: ['created_day', (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : format(new Date(), 'yyyy-MM-dd'))],
};

/** Cria a linha (com o `type` dado). Devolve o hábito. */
export async function insertHabitRow(type: string, def: Partial<HabitDef> & { title: string }): Promise<HabitDef> {
  await ensureHabitSchema();
  const d = await getDb();
  const max = await d.getFirstAsync<{ m: number | null }>('SELECT MAX(order_index) AS m FROM nudges');
  const full: Partial<HabitDef> = {
    body: '',
    emoji: null,
    enabled: true,
    scheduleTime: '08:00',
    orderIndex: (max?.m ?? -1) + 1,
    strict: false,
    createdDay: format(new Date(), 'yyyy-MM-dd'),
    ...def,
  };
  const cols = ['type'];
  const vals: (string | number | null)[] = [type];
  for (const [field, [col, ser]] of Object.entries(FIELD_COLUMNS)) {
    if (field in full) {
      cols.push(col);
      vals.push(ser((full as Record<string, unknown>)[field]));
    }
  }
  await d.runAsync(
    `INSERT INTO nudges (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    vals,
  );
  const created = await getHabitRow(type);
  if (!created) throw new Error('Falha ao criar o hábito.');
  return created;
}

export async function updateHabitRow(type: string, patch: Partial<HabitDef>): Promise<HabitDef | null> {
  await ensureHabitSchema();
  const d = await getDb();
  const sets: string[] = [];
  const vals: (string | number | null)[] = [];
  for (const [field, [col, ser]] of Object.entries(FIELD_COLUMNS)) {
    if (field in patch && (patch as Record<string, unknown>)[field] !== undefined) {
      sets.push(`${col} = ?`);
      vals.push(ser((patch as Record<string, unknown>)[field]));
    }
  }
  if (sets.length) {
    sets.push("updated_at = datetime('now')");
    vals.push(type);
    await d.runAsync(`UPDATE nudges SET ${sets.join(', ')} WHERE type = ?`, vals);
  }
  return getHabitRow(type);
}

/** Apaga o hábito e tudo o que é dele (registros, quantidades, deslizes, estado). */
export async function deleteHabitRow(type: string): Promise<void> {
  await ensureHabitSchema();
  const d = await getDb();
  await d.runAsync('DELETE FROM nudges WHERE type = ?', [type]);
  await d.runAsync('DELETE FROM nudge_completions WHERE nudge_type = ? OR nudge_type LIKE ?', [type, `${type}:%`]);
  await d.runAsync('DELETE FROM habit_values WHERE key = ?', [type]);
  await d.runAsync('DELETE FROM habit_slips WHERE key = ?', [type]);
  await d.runAsync('DELETE FROM habit_state WHERE nudge_type = ?', [type]);
  await d.runAsync('DELETE FROM automaticity WHERE key = ?', [type]);
}

// ————————————————— registros do dia —————————————————

export interface DayMarks {
  done?: boolean;
  min?: boolean;
  folga?: boolean;
  skip?: boolean;
  missed?: boolean;
}

/** Todas as marcas de um hábito, por dia. */
export async function getMarksOf(type: string, fromDay = '0000-00-00'): Promise<Record<string, DayMarks>> {
  await ensureHabitSchema();
  const d = await getDb();
  const rows = await d.getAllAsync<{ nudge_type: string; date: string }>(
    `SELECT nudge_type, date FROM nudge_completions WHERE (nudge_type = ? OR nudge_type LIKE ?) AND date >= ?`,
    [type, `${type}:%`, fromDay],
  );
  const out: Record<string, DayMarks> = {};
  for (const r of rows) {
    const m = (out[r.date] ??= {});
    const suffix = r.nudge_type === type ? '' : r.nudge_type.slice(type.length + 1);
    if (suffix === '') m.done = true;
    else if (suffix === 'min') m.min = true;
    else if (suffix === 'folga') m.folga = true;
    else if (suffix === 'skip') m.skip = true;
    else if (suffix === 'missed') m.missed = true;
  }
  return out;
}

/** Grava (true) ou apaga (false) uma marca `<type><sufixo>` num dia. */
export async function setMark(type: string, suffix: '' | ':min' | ':folga' | ':skip' | ':missed', day: string, on: boolean): Promise<void> {
  await ensureHabitSchema();
  const d = await getDb();
  const key = `${type}${suffix}`;
  if (on) await d.runAsync('INSERT OR IGNORE INTO nudge_completions (nudge_type, date) VALUES (?, ?)', [key, day]);
  else await d.runAsync('DELETE FROM nudge_completions WHERE nudge_type = ? AND date = ?', [key, day]);
}

/** Limpa todas as marcas do dia (feito, mínimo, folga, não fiz, sem resposta) e a quantidade. */
export async function clearDayRows(type: string, day: string): Promise<void> {
  await ensureHabitSchema();
  const d = await getDb();
  await d.runAsync(
    `DELETE FROM nudge_completions WHERE date = ? AND (nudge_type = ? OR nudge_type IN (?, ?, ?, ?))`,
    [day, type, `${type}:min`, `${type}:folga`, `${type}:skip`, `${type}:missed`],
  );
  await d.runAsync('DELETE FROM habit_values WHERE key = ? AND date = ?', [type, day]);
}

export async function getValuesOf(type: string, fromDay = '0000-00-00'): Promise<Record<string, number>> {
  await ensureHabitSchema();
  const d = await getDb();
  const rows = await d.getAllAsync<{ date: string; value: number }>(
    'SELECT date, value FROM habit_values WHERE key = ? AND date >= ?',
    [type, fromDay],
  );
  const out: Record<string, number> = {};
  for (const r of rows) out[r.date] = r.value;
  return out;
}

export async function setValueRow(type: string, day: string, value: number | null): Promise<void> {
  await ensureHabitSchema();
  const d = await getDb();
  if (value === null || !Number.isFinite(value)) {
    await d.runAsync('DELETE FROM habit_values WHERE key = ? AND date = ?', [type, day]);
  } else {
    await d.runAsync(
      `INSERT INTO habit_values (key, date, value) VALUES (?, ?, ?)
       ON CONFLICT(key, date) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
      [type, day, value],
    );
  }
}

/** Valores de todos os hábitos num intervalo de dias (para a sincronização). */
export async function getValuesBetween(fromDay: string, toDay: string): Promise<{ key: string; date: string; value: number }[]> {
  await ensureHabitSchema();
  const d = await getDb();
  return d.getAllAsync<{ key: string; date: string; value: number }>(
    'SELECT key, date, value FROM habit_values WHERE date >= ? AND date <= ?',
    [fromDay, toDay],
  );
}

// ————————————————— deslizes e vontades —————————————————

interface SlipRow {
  id: number;
  key: string;
  at: string;
  place: string | null;
  emotion: string | null;
  trigger: string | null;
  note: string | null;
  resisted: number;
}

const rowToSlip = (r: SlipRow): HabitSlip => ({
  id: r.id,
  key: r.key,
  at: r.at,
  place: r.place,
  emotion: r.emotion,
  trigger: r.trigger,
  note: r.note,
  resisted: r.resisted === 1,
});

/** Grava um deslize (ou vontade superada). Idempotente por (hábito, instante). */
export async function addSlipRow(s: Omit<HabitSlip, 'id'>): Promise<void> {
  await ensureHabitSchema();
  const d = await getDb();
  await d.runAsync(
    `INSERT OR IGNORE INTO habit_slips (key, at, place, emotion, trigger, note, resisted) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [s.key, s.at, s.place?.trim() || null, s.emotion?.trim() || null, s.trigger?.trim() || null, s.note?.trim() || null, s.resisted ? 1 : 0],
  );
}

export async function listSlipRows(type: string | null, sinceISO: string): Promise<HabitSlip[]> {
  await ensureHabitSchema();
  const d = await getDb();
  const rows = type
    ? await d.getAllAsync<SlipRow>('SELECT * FROM habit_slips WHERE key = ? AND at >= ? ORDER BY at', [type, sinceISO])
    : await d.getAllAsync<SlipRow>('SELECT * FROM habit_slips WHERE at >= ? ORDER BY at', [sinceISO]);
  return rows.map(rowToSlip);
}

// ————————————————— SRBAI —————————————————

export async function recordSrbaiRow(type: string, day: string, items: number[]): Promise<void> {
  await ensureHabitSchema();
  const d = await getDb();
  const q = items.slice(0, 4).map((x) => Math.max(1, Math.min(7, Math.round(x))));
  while (q.length < 4) q.push(q[q.length - 1] ?? 4);
  const mean = q.reduce((a, b) => a + b, 0) / 4;
  await d.runAsync(
    `INSERT INTO automaticity (key, date, score, q1, q2, q3, q4) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(key, date) DO UPDATE SET score = excluded.score, q1 = excluded.q1, q2 = excluded.q2,
       q3 = excluded.q3, q4 = excluded.q4`,
    [type, day, Math.round(mean), q[0], q[1], q[2], q[3]],
  );
}

interface SrbaiRow {
  key: string;
  date: string;
  score: number;
  q1: number | null;
  q2: number | null;
  q3: number | null;
  q4: number | null;
}

function rowToSrbai(r: SrbaiRow): SrbaiEntry {
  const items = [r.q1, r.q2, r.q3, r.q4].filter((x): x is number => typeof x === 'number');
  // A pergunta antiga (v1.106) era um item só ("faço sem pensar"): vale como média.
  const list = items.length === 4 ? items : [r.score];
  return { key: r.key, date: r.date, items: list, mean: list.reduce((a, b) => a + b, 0) / list.length };
}

export async function listSrbaiRows(type: string | null, fromDay = '0000-00-00'): Promise<SrbaiEntry[]> {
  await ensureHabitSchema();
  const d = await getDb();
  const rows = type
    ? await d.getAllAsync<SrbaiRow>('SELECT * FROM automaticity WHERE key = ? AND date >= ? ORDER BY date', [type, fromDay])
    : await d.getAllAsync<SrbaiRow>('SELECT * FROM automaticity WHERE date >= ? ORDER BY date', [fromDay]);
  return rows.map(rowToSrbai);
}
