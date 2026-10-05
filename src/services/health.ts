import { Platform } from 'react-native';
import type { Permission } from 'react-native-health-connect';
import { getKV, getUserConfig, setKV } from './database';

/**
 * Acesso aos dados de saúde do Android via Health Connect (substituto oficial
 * do Google Fit). Só lê: sono, sessões de exercício, passos, frequência
 * cardíaca e composição corporal (massa magra / % de gordura).
 *
 * Por que tudo é "lazy" e defensivo: o módulo nativo
 * (`react-native-health-connect`) usa `TurboModuleRegistry.getEnforcing`, que
 * LANÇA no momento do import se o módulo não estiver presente (ex.: build
 * antigo, Expo Go, iOS). Como este serviço é importado pelo coach e pela Home,
 * um throw no import derrubaria o app inteiro. Por isso carregamos o módulo
 * sob demanda dentro de try/catch e só os TIPOS são importados estaticamente
 * (import type é apagado na compilação, então não gera require em runtime).
 */

type HealthConnectModule = typeof import('react-native-health-connect');

let cachedModule: HealthConnectModule | null | undefined;

function getModule(): HealthConnectModule | null {
  if (cachedModule !== undefined) return cachedModule;
  if (Platform.OS !== 'android') {
    cachedModule = null;
    return cachedModule;
  }
  try {
    // require sob demanda: se o módulo nativo não existir, o getEnforcing
    // lança aqui e nós tratamos, em vez de quebrar o app no import.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    cachedModule = require('react-native-health-connect') as HealthConnectModule;
  } catch {
    cachedModule = null;
  }
  return cachedModule;
}

/**
 * Permissões NÚCLEO (sono/exercício/passos): sem elas o card pede pra conectar.
 * As EXTRAS (FC + composição corporal) são opcionais — quem conectou antes da
 * v1.57 continua funcionando; os campos novos só aparecem ao liberá-las.
 */
const CORE_PERMISSIONS: Permission[] = [
  { accessType: 'read', recordType: 'SleepSession' },
  { accessType: 'read', recordType: 'ExerciseSession' },
  { accessType: 'read', recordType: 'Steps' },
];

const EXTRA_PERMISSIONS: Permission[] = [
  { accessType: 'read', recordType: 'HeartRate' },
  { accessType: 'read', recordType: 'Weight' },
  { accessType: 'read', recordType: 'BodyFat' },
];

const ALL_PERMISSIONS: Permission[] = [...CORE_PERMISSIONS, ...EXTRA_PERMISSIONS];

let initialized = false;
async function ensureInit(m: HealthConnectModule): Promise<boolean> {
  if (initialized) return true;
  try {
    initialized = await m.initialize();
    return initialized;
  } catch (err) {
    console.warn('[health] initialize() failed:', err);
    return false;
  }
}

/**
 * Health Connect está disponível neste aparelho? (false em iOS, em builds sem
 * o módulo nativo, ou se o app Health Connect não estiver instalado/atualizado.)
 */
export async function isHealthConnectAvailable(): Promise<boolean> {
  const m = getModule();
  if (!m) return false;
  try {
    const status = await m.getSdkStatus();
    return status === m.SdkAvailabilityStatus.SDK_AVAILABLE;
  } catch {
    return false;
  }
}

type GrantedPerm = { accessType?: string; recordType?: string };

function hasAll(granted: GrantedPerm[], wanted: Permission[]): boolean {
  return wanted.every((p) =>
    granted.some(
      (g) => g.accessType === p.accessType && g.recordType === p.recordType,
    ),
  );
}

async function getGranted(m: HealthConnectModule): Promise<GrantedPerm[]> {
  try {
    return (await m.getGrantedPermissions()) as GrantedPerm[];
  } catch {
    return [];
  }
}

/** Já temos as permissões NÚCLEO (sono/exercício/passos)? (não abre prompt) */
export async function hasHealthPermissions(): Promise<boolean> {
  const m = getModule();
  if (!m || !(await ensureInit(m))) return false;
  return hasAll(await getGranted(m), CORE_PERMISSIONS);
}

/** Já temos TAMBÉM as extras (FC + massa magra + gordura)? (não abre prompt) */
export async function hasExtraHealthPermissions(): Promise<boolean> {
  const m = getModule();
  if (!m || !(await ensureInit(m))) return false;
  return hasAll(await getGranted(m), EXTRA_PERMISSIONS);
}

/**
 * Abre o fluxo de permissão do Health Connect (pede TODAS, núcleo + extras) e
 * devolve se as leituras NÚCLEO foram concedidas. Seguro chamar mesmo sem o
 * app Health Connect — retorna false em vez de lançar.
 */
export async function requestHealthPermissions(): Promise<boolean> {
  const m = getModule();
  if (!m || !(await ensureInit(m))) return false;
  try {
    const granted = await m.requestPermission(ALL_PERMISSIONS);
    return hasAll(granted as GrantedPerm[], CORE_PERMISSIONS);
  } catch (err) {
    console.warn('[health] requestPermission() failed:', err);
    return false;
  }
}

/** Abre as configurações do Health Connect (gerenciar permissões/dados). */
export async function openHealthSettings(): Promise<void> {
  const m = getModule();
  if (!m) return;
  try {
    await m.openHealthConnectSettings();
  } catch (err) {
    console.warn('[health] openHealthConnectSettings() failed:', err);
  }
}

export interface HealthSnapshot {
  /** Minutos dormidos na última noite (sessões terminadas nas últimas 24h), ou null. */
  sleepMinutesLastNight: number | null;
  /** Nº de sessões de exercício NESTA SEMANA (zera segunda-feira 00:00). */
  exerciseSessionsWeek: number;
  /** Minutos totais de exercício nesta semana (segunda → agora). */
  exerciseMinutesWeek: number;
  /**
   * Minutos NESTA SEMANA com FC acima de 80% da FC máxima estimada
   * (Tanaka: 208 − 0,7 × idade). null = sem ano de nascimento, sem permissão ou sem dados.
   */
  hrHighMinutesWeek: number | null;
  /**
   * Minutos NESTA SEMANA em ZONA 2 (~60–70% da FC máxima estimada) — a base
   * aeróbica. Mesmas condições de null da métrica de FC alta.
   */
  zone2MinutesWeek: number | null;
  /** Passos somados nesta semana (segunda → agora). */
  stepsWeek: number;
  /** Passos de hoje (desde a meia-noite local). */
  stepsToday: number;
  /** Peso corporal mais recente, em kg (último ano). null = sem registro/permissão. */
  weightKg: number | null;
  /** % de gordura corporal mais recente (último ano). null = sem registro/permissão. */
  bodyFatPct: number | null;
}

function durationMinutes(startTime: string, endTime: string): number {
  return Math.max(0, (new Date(endTime).getTime() - new Date(startTime).getTime()) / 60000);
}

/**
 * Lê todos os registros de um tipo na janela e devolve o MAIS RECENTE por
 * `time` (registros instantâneos: Weight, BodyFat…). Não usa `pageSize`/
 * `ascendingOrder` (algumas versões do Health Connect ignoram ou esvaziam a
 * consulta com essas opções — era por isso que o PESO vinha vazio mesmo com a
 * gordura corporal funcionando). Retorna null se não houver registro.
 */
async function latestInstant(
  m: HealthConnectModule,
  recordType: string,
  startISO: string,
  endISO: string,
): Promise<({ time?: string } & Record<string, unknown>) | null> {
  try {
    const res = (await m.readRecords(recordType as never, {
      timeRangeFilter: { operator: 'between', startTime: startISO, endTime: endISO },
    })) as { records: ({ time?: string } & Record<string, unknown>)[] };
    if (!res.records.length) return null;
    return res.records.reduce((a, b) =>
      new Date(a.time ?? 0).getTime() >= new Date(b.time ?? 0).getTime() ? a : b,
    );
  } catch {
    return null;
  }
}

/** Meia-noite da SEGUNDA-FEIRA da semana atual (hora local). */
function startOfWeekMonday(now: Date): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const sinceMonday = (d.getDay() + 6) % 7; // 0=segunda … 6=domingo
  d.setDate(d.getDate() - sinceMonday);
  return d;
}

/**
 * Lê TODAS as páginas de um tipo de registro na janela (o Health Connect
 * pagina; sem isso, semanas cheias de amostras de FC viriam truncadas).
 */
async function readAllRecords(
  m: HealthConnectModule,
  recordType: never,
  startTime: string,
  endTime: string,
): Promise<unknown[]> {
  const out: unknown[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 20; page++) {
    const res = (await m.readRecords(recordType, {
      timeRangeFilter: { operator: 'between', startTime, endTime },
      pageSize: 1000,
      ...(pageToken ? { pageToken } : {}),
    })) as { records: unknown[]; pageToken?: string };
    out.push(...res.records);
    pageToken = res.pageToken;
    if (!pageToken || res.records.length === 0) break;
  }
  return out;
}

// ————————————— Fontes, deduplicação e FC (v1.106) —————————————

type RecordMeta = {
  dataOrigin?: string;
  lastModifiedTime?: string;
  recordingMethod?: number;
  device?: { type?: number; manufacturer?: string; model?: string };
};

/** Apps que trazem o RELÓGIO Huawei para o Health Connect. */
export const WATCH_ORIGINS = ['nl.appyhapps.healthsync', 'com.huawei.health'];

const ORIGIN_LABEL: Record<string, string> = {
  'nl.appyhapps.healthsync': 'Health Sync',
  'com.huawei.health': 'Huawei Health',
  'com.google.android.apps.fitness': 'Google Fit',
  'com.google.android.apps.healthdata': 'Health Connect',
  'com.samsung.android.app.health': 'Samsung Health',
};

export function originLabel(pkg: string | undefined | null): string {
  if (!pkg) return 'origem desconhecida';
  return ORIGIN_LABEL[pkg] ?? pkg;
}

/** Health Connect: DEVICE_TYPE_WATCH=1 (a lib omite do enum), BAND=6, RING=4, PHONE=2. */
function deviceLabel(type: number | undefined): string | null {
  switch (type) {
    case 1:
      return 'relógio';
    case 6:
      return 'pulseira';
    case 4:
      return 'anel';
    case 7:
      return 'cinta';
    case 2:
      return 'celular';
    case 3:
      return 'balança';
    default:
      return null;
  }
}

function methodLabel(method: number | undefined): string | null {
  switch (method) {
    case 1:
      return 'gravado ativamente';
    case 2:
      return 'automático';
    case 3:
      return 'digitado à mão';
    default:
      return null;
  }
}

/**
 * Soma de passos na janela SEM contagem dupla. Health Sync (relógio) e Google
 * Fit (celular) escrevem os MESMOS passos; somar `readRecords` dobrava o
 * número. O `aggregate` do Health Connect deduplica pela prioridade de fontes
 * que o próprio usuário define no Health Connect. Se falhar (versão antiga),
 * cai na soma crua — e `deduped=false` diz isso a quem exibe.
 */
async function sumSteps(
  m: HealthConnectModule,
  startTime: string,
  endTime: string,
): Promise<{ total: number; raw: number | null; deduped: boolean }> {
  try {
    const agg = await m.aggregateRecord({
      recordType: 'Steps',
      timeRangeFilter: { operator: 'between', startTime, endTime },
    });
    const total = Math.round(Number(agg?.COUNT_TOTAL ?? 0));
    if (Number.isFinite(total)) return { total, raw: null, deduped: true };
  } catch {
    /* cai para a soma crua */
  }
  const recs = (await readAllRecords(m, 'Steps' as never, startTime, endTime)) as { count?: number }[];
  const raw = recs.reduce((a, r) => a + (r.count ?? 0), 0);
  return { total: raw, raw, deduped: false };
}

export interface ExerciseSessionInfo {
  start: string;
  end: string;
  minutes: number;
  exerciseType: number;
  title: string | null;
  origin: string | null;
  device: string | null;
  /** Gravado ativamente (o usuário iniciou o treino no relógio/app). */
  active: boolean;
}

/**
 * Sessões de exercício DEDUPLICADAS: o mesmo treino chega por Huawei Health e
 * por Health Sync (ou é reenviado). Duas sessões que se sobrepõem em mais da
 * metade da menor contam como UMA. Fica a de MAIOR PRIORIDADE — relógio antes
 * de celular, gravada ativamente antes de automática — e, empatando, a mais longa.
 */
function dedupeSessions(recs: unknown[]): ExerciseSessionInfo[] {
  const all: ExerciseSessionInfo[] = [];
  for (const raw of recs) {
    const r = raw as {
      startTime: string;
      endTime: string;
      exerciseType?: number;
      title?: string;
      metadata?: RecordMeta;
    };
    const minutes = durationMinutes(r.startTime, r.endTime);
    if (minutes <= 0) continue;
    all.push({
      start: r.startTime,
      end: r.endTime,
      minutes,
      exerciseType: r.exerciseType ?? 0,
      title: r.title?.trim() || null,
      origin: r.metadata?.dataOrigin ?? null,
      device: deviceLabel(r.metadata?.device?.type),
      active: r.metadata?.recordingMethod === 1,
    });
  }
  const prio = (x: ExerciseSessionInfo) =>
    (x.origin && WATCH_ORIGINS.includes(x.origin) ? 2 : 0) + (x.active ? 1 : 0);
  all.sort((a, b) => prio(b) - prio(a) || b.minutes - a.minutes); // quem vence vem primeiro
  const kept: ExerciseSessionInfo[] = [];
  for (const s of all) {
    const s0 = new Date(s.start).getTime();
    const s1 = new Date(s.end).getTime();
    const dup = kept.some((k) => {
      const k0 = new Date(k.start).getTime();
      const k1 = new Date(k.end).getTime();
      const overlap = Math.min(s1, k1) - Math.max(s0, k0);
      return overlap > 0.5 * Math.min(s1 - s0, k1 - k0);
    });
    if (!dup) kept.push(s);
  }
  return kept.sort((a, b) => a.start.localeCompare(b.start));
}

/**
 * Sessões de exercício (deduplicadas) na janela. `origins` filtra as origens
 * ANTES de deduplicar (senão uma cópia mais longa de outra origem "engoliria" a
 * do relógio). [] sem permissão/dados.
 */
export async function getExerciseSessions(
  startISO: string,
  endISO: string,
  origins?: string[],
): Promise<ExerciseSessionInfo[]> {
  const m = getModule();
  if (!m || !(await ensureInit(m))) return [];
  try {
    let recs = await readAllRecords(m, 'ExerciseSession' as never, startISO, endISO);
    if (origins) {
      recs = recs.filter((r) => {
        const o = (r as { metadata?: RecordMeta }).metadata?.dataOrigin;
        return !!o && origins.includes(o);
      });
    }
    return dedupeSessions(recs);
  } catch {
    return [];
  }
}

/**
 * FC máxima estimada — Tanaka (2001): 208 − 0,7 × idade. A fórmula 220 − idade
 * subestima a FC máxima de quem tem mais de ~40 anos e inflava os minutos de
 * "FC alta".
 */
export function estimateMaxHr(age: number): number {
  return Math.round(208 - 0.7 * age);
}

/**
 * Minutos em cada zona, PONDERADOS PELO TEMPO: cada amostra vale o intervalo
 * até a próxima, com teto de 60 s (amostra isolada não vira um minuto inteiro
 * de esforço, nem um buraco de 10 min herda a última FC). Amostras repetidas
 * (mesmo instante, fontes diferentes) contam uma vez.
 */
function hrZoneMinutes(
  records: { samples?: { time: string; beatsPerMinute: number }[] }[],
  maxHr: number,
): { zone2: number; high: number } {
  const byTime = new Map<number, number>();
  for (const rec of records) {
    for (const smp of rec.samples ?? []) {
      const t = new Date(smp.time).getTime();
      const bpm = smp.beatsPerMinute;
      if (!Number.isFinite(t) || !(bpm > 25 && bpm < 230)) continue;
      byTime.set(t, bpm);
    }
  }
  const times = [...byTime.keys()].sort((a, b) => a - b);
  let zone2Ms = 0;
  let highMs = 0;
  for (let i = 0; i < times.length; i++) {
    const next = times[i + 1];
    const dt = next == null ? 5_000 : Math.min(60_000, next - times[i]);
    const bpm = byTime.get(times[i])!;
    if (bpm > 0.8 * maxHr) highMs += dt;
    else if (bpm >= 0.6 * maxHr && bpm <= 0.7 * maxHr) zone2Ms += dt;
  }
  return { zone2: Math.round(zone2Ms / 60_000), high: Math.round(highMs / 60_000) };
}

/**
 * Lê um retrato dos dados de saúde. Retorna null se Health Connect não estiver
 * disponível ou sem permissão — nunca lança. Campos extras (FC/composição)
 * voltam null quando a permissão deles não foi concedida.
 */
export async function getHealthSnapshot(): Promise<HealthSnapshot | null> {
  const m = getModule();
  if (!m || !(await ensureInit(m))) return null;
  if (!(await hasHealthPermissions())) return null;

  try {
    const now = new Date();
    const nowISO = now.toISOString();

    // SONO: o filtro do Health Connect corta sessões que COMEÇARAM fora da
    // janela — uma janela curta perdia a noite anterior quando o app abria à
    // tarde. Lemos 48h e consideramos "última noite" as sessões TERMINADAS nas
    // últimas 24h (cobre cochilos + noite, ignora a noite retrasada).
    const sleepWindowStart = new Date(now.getTime() - 48 * 3600_000).toISOString();
    const sleep = await m.readRecords('SleepSession', {
      timeRangeFilter: { operator: 'between', startTime: sleepWindowStart, endTime: nowISO },
    });
    const dayAgo = now.getTime() - 24 * 3600_000;
    let sleepMin = 0;
    let sleepCount = 0;
    for (const r of sleep.records) {
      if (new Date(r.endTime).getTime() < dayAgo) continue;
      sleepMin += durationMinutes(r.startTime, r.endTime);
      sleepCount++;
    }
    // Fallback: se nada terminou nas últimas 24h (ex.: app aberto à noite, antes
    // de dormir), pega a sessão de sono MAIS LONGA das últimas 48h — evita
    // mostrar "sem registro" quando há, sim, sono recente.
    if (!sleepCount && sleep.records.length) {
      const longest = sleep.records.reduce((a, b) =>
        durationMinutes(a.startTime, a.endTime) >= durationMinutes(b.startTime, b.endTime) ? a : b,
      );
      sleepMin = durationMinutes(longest.startTime, longest.endTime);
      sleepCount = 1;
    }
    const sleepMinutesLastNight = sleepCount ? Math.round(sleepMin) : null;

    // EXERCÍCIO + PASSOS: semana civil — ZERA toda segunda-feira 00:00 e
    // acumula até domingo (antes era janela móvel de 7 dias, que nunca zerava
    // e parecia "cumulativa").
    const weekStartISO = startOfWeekMonday(now).toISOString();
    const weekFilter = {
      operator: 'between' as const,
      startTime: weekStartISO,
      endTime: nowISO,
    };

    // Sessões deduplicadas (o mesmo treino chega por Huawei Health e Health Sync).
    const exercise = dedupeSessions(
      await readAllRecords(m, 'ExerciseSession' as never, weekFilter.startTime, weekFilter.endTime),
    );
    let exMin = 0;
    for (const r of exercise) exMin += r.minutes;

    // Passos via AGGREGATE (deduplicado): relógio + celular não somam em dobro.
    const stepsTotal = (await sumSteps(m, weekStartISO, nowISO)).total;

    // Passos de hoje: da meia-noite local até agora.
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const stepsToday = (await sumSteps(m, todayStart.toISOString(), nowISO)).total;

    // FC (semana): das MESMAS amostras saem DUAS métricas — minutos em ZONA 2
    // (~60–70% da FC máxima; base aeróbica) e minutos de ALTA intensidade
    // (>80%), ponderados pelo tempo (ver hrZoneMinutes). Precisa do ano de
    // nascimento para estimar a FC máxima (Tanaka: 208 − 0,7 × idade).
    let hrHighMinutesWeek: number | null = null;
    let zone2MinutesWeek: number | null = null;
    try {
      const birthYear = (await getUserConfig()).birthYear;
      if (birthYear != null) {
        const age = Math.max(10, Math.min(110, now.getFullYear() - birthYear));
        const maxHr = estimateMaxHr(age);
        const hrRecords = (await readAllRecords(
          m,
          'HeartRate' as never,
          weekStartISO,
          nowISO,
        )) as { samples?: { time: string; beatsPerMinute: number }[] }[];
        const zones = hrZoneMinutes(hrRecords, maxHr);
        hrHighMinutesWeek = zones.high;
        zone2MinutesWeek = zones.zone2;
      }
    } catch {
      hrHighMinutesWeek = null; // sem permissão de FC — campos ficam ocultos
      zone2MinutesWeek = null;
    }

    // COMPOSIÇÃO CORPORAL: registro mais recente do último ano. (Era massa
    // magra, mas o Health Connect do usuário não a expõe — peso é universal.)
    const yearStart = new Date(now.getTime() - 365 * 24 * 3600_000).toISOString();
    let weightKg: number | null = null;
    const wRec = await latestInstant(m, 'Weight', yearStart, nowISO);
    const wMass = wRec?.weight as { inKilograms?: number } | undefined;
    const kg = wMass?.inKilograms;
    if (typeof kg === 'number' && kg > 0) weightKg = Math.round(kg * 10) / 10;

    let bodyFatPct: number | null = null;
    const fRec = await latestInstant(m, 'BodyFat', yearStart, nowISO);
    const pct = fRec?.percentage as number | undefined;
    if (typeof pct === 'number' && pct > 0) bodyFatPct = Math.round(pct * 10) / 10;

    return {
      sleepMinutesLastNight,
      exerciseSessionsWeek: exercise.length,
      exerciseMinutesWeek: Math.round(exMin),
      hrHighMinutesWeek,
      zone2MinutesWeek,
      stepsWeek: stepsTotal,
      stepsToday,
      weightKg,
      bodyFatPct,
    };
  } catch {
    return null;
  }
}

// ————————————— Série histórica (v1.103) —————————————

function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Persiste um instantâneo POR DIA dos últimos `daysBack` dias em health_daily.
 * Até aqui o Health Connect era só lido ao vivo; sem série histórica não há o
 * que exportar. Chamado ao abrir o app e no check-in da manhã. Best-effort e
 * idempotente: campos ausentes não apagam o que já foi gravado (COALESCE).
 *
 * Relógio Huawei: os dados só chegam ao Health Connect se o Huawei Health
 * estiver sincronizando com ele. Sem isso, os dias ficam sem estes campos — e
 * a exportação diz isso explicitamente, em vez de tratar como zero.
 */
export async function captureHealthDaily(daysBack = 3): Promise<void> {
  const m = getModule();
  if (!m || !(await ensureInit(m))) return;
  if (!(await hasHealthPermissions())) return;
  try {
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - daysBack);
    const startISO = start.toISOString();
    const nowISO = now.toISOString();

    // Passos: um AGGREGATE por dia local (deduplicado entre relógio e celular).
    const steps = new Map<string, number>();
    for (let i = 0; i <= daysBack; i++) {
      const d0 = new Date(start);
      d0.setDate(start.getDate() + i);
      const d1 = new Date(d0);
      d1.setDate(d0.getDate() + 1);
      const end = d1.getTime() > now.getTime() ? nowISO : d1.toISOString();
      try {
        const r = await sumSteps(m, d0.toISOString(), end);
        if (r.total > 0) steps.set(localDayKey(d0), r.total);
      } catch {
        /* sem passos */
      }
    }

    const exercise = new Map<string, number>();
    try {
      const recs = dedupeSessions(await readAllRecords(m, 'ExerciseSession' as never, startISO, nowISO));
      for (const r of recs) {
        const k = localDayKey(new Date(r.start));
        exercise.set(k, (exercise.get(k) ?? 0) + r.minutes);
      }
    } catch {
      /* sem exercício */
    }

    // Sono: a sessão pertence ao dia em que TERMINOU (a noite de ontem conta
    // para hoje de manhã). Guarda a mais longa do dia.
    const sleep = new Map<string, { start: string; end: string; minutes: number }>();
    try {
      const res = await m.readRecords('SleepSession', {
        timeRangeFilter: {
          operator: 'between',
          startTime: new Date(start.getTime() - 12 * 3600_000).toISOString(),
          endTime: nowISO,
        },
      });
      for (const r of res.records) {
        const k = localDayKey(new Date(r.endTime));
        const minutes = Math.round(durationMinutes(r.startTime, r.endTime));
        const prev = sleep.get(k);
        if (!prev || minutes > prev.minutes) sleep.set(k, { start: r.startTime, end: r.endTime, minutes });
      }
    } catch {
      /* sem sono */
    }

    // FC de repouso ≈ percentil 10 das amostras do dia (robusto a artefatos).
    const restingHr = new Map<string, number>();
    try {
      const recs = (await readAllRecords(m, 'HeartRate' as never, startISO, nowISO)) as {
        samples?: { time: string; beatsPerMinute: number }[];
      }[];
      const byDay = new Map<string, number[]>();
      for (const rec of recs) {
        for (const s of rec.samples ?? []) {
          if (!(s.beatsPerMinute > 25 && s.beatsPerMinute < 220)) continue;
          const k = localDayKey(new Date(s.time));
          if (!byDay.has(k)) byDay.set(k, []);
          byDay.get(k)!.push(s.beatsPerMinute);
        }
      }
      for (const [k, arr] of byDay) {
        if (arr.length < 20) continue;
        arr.sort((a, b) => a - b);
        restingHr.set(k, Math.round(arr[Math.floor(arr.length * 0.1)]));
      }
    } catch {
      /* sem FC */
    }

    const weight = new Map<string, number>();
    try {
      const res = (await m.readRecords('Weight' as never, {
        timeRangeFilter: { operator: 'between', startTime: startISO, endTime: nowISO },
      })) as { records: { time?: string; weight?: { inKilograms?: number } }[] };
      for (const r of res.records) {
        const kg = r.weight?.inKilograms;
        if (!r.time || typeof kg !== 'number' || kg <= 0) continue;
        weight.set(localDayKey(new Date(r.time)), Math.round(kg * 10) / 10);
      }
    } catch {
      /* sem peso */
    }

    const { upsertHealthDaily } = await import('./database');
    for (let i = 0; i <= daysBack; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const k = localDayKey(d);
      const s = sleep.get(k);
      const row = {
        date: k,
        steps: steps.has(k) ? steps.get(k)! : null,
        sleepStart: s?.start ?? null,
        sleepEnd: s?.end ?? null,
        sleepMinutes: s?.minutes ?? null,
        exerciseMinutes: exercise.has(k) ? Math.round(exercise.get(k)!) : null,
        restingHr: restingHr.get(k) ?? null,
        weightKg: weight.get(k) ?? null,
      };
      const hasAny = Object.entries(row).some(([key, v]) => key !== 'date' && v !== null);
      if (hasAny) await upsertHealthDaily(row);
    }
  } catch (err) {
    console.warn('[health] captureHealthDaily falhou:', err);
  }
}

/**
 * Diagnóstico (long-press no título "Saúde"): para cada tipo, quantos registros
 * o Health Connect devolveu, se a permissão foi concedida e eventual erro.
 * Ajuda a entender, no aparelho, por que peso/sono não aparecem.
 */
export async function getHealthDiagnostics(): Promise<string> {
  const m = getModule();
  if (!m || !(await ensureInit(m))) return 'Health Connect indisponível neste aparelho.';
  const now = new Date();
  const nowISO = now.toISOString();
  const yearStart = new Date(now.getTime() - 365 * 24 * 3600_000).toISOString();
  const d2 = new Date(now.getTime() - 48 * 3600_000).toISOString();

  let granted: GrantedPerm[] = [];
  try {
    granted = await getGranted(m);
  } catch {
    /* ignore */
  }
  const has = (rt: string) => granted.some((g) => g.recordType === rt);

  // Para cada tipo: quantos registros, DE ONDE vieram (app, aparelho, modo de
  // gravação) e com quanto ATRASO chegaram (lastModifiedTime − fim do
  // registro): é isso que diz se o relógio está sincronizando e se dá para
  // reagir "agora" ou só no dia seguinte.
  const probe = async (rt: string, since: string): Promise<string> => {
    try {
      const recs = (await readAllRecords(m, rt as never, since, nowISO)) as {
        time?: string;
        endTime?: string;
        metadata?: RecordMeta;
      }[];
      const head = `${rt}: perm=${has(rt) ? 'sim' : 'NÃO'} · ${recs.length} registro(s)`;
      if (!recs.length) return head;
      const byOrigin = new Map<string, { n: number; lags: number[]; tags: Set<string>; last: number }>();
      for (const r of recs) {
        const key = originLabel(r.metadata?.dataOrigin);
        const g = byOrigin.get(key) ?? { n: 0, lags: [], tags: new Set<string>(), last: 0 };
        g.n++;
        const endMs = new Date(r.endTime ?? r.time ?? 0).getTime();
        const modMs = new Date(r.metadata?.lastModifiedTime ?? 0).getTime();
        if (endMs > 0 && modMs >= endMs) g.lags.push((modMs - endMs) / 60_000);
        if (endMs > g.last) g.last = endMs;
        const dev = deviceLabel(r.metadata?.device?.type);
        const met = methodLabel(r.metadata?.recordingMethod);
        if (dev) g.tags.add(dev);
        if (met) g.tags.add(met);
        byOrigin.set(key, g);
      }
      const parts = [...byOrigin.entries()].map(([origin, g]) => {
        g.lags.sort((a, b) => a - b);
        const lag = g.lags.length ? g.lags[Math.floor(g.lags.length / 2)] : null;
        const lagTxt = lag == null ? '' : ` · atraso ~${lag < 90 ? `${Math.round(lag)} min` : `${(lag / 60).toFixed(1)} h`}`;
        const agoH = g.last ? (now.getTime() - g.last) / 3600_000 : null;
        const lastTxt = agoH == null ? '' : ` · último há ${agoH < 1 ? `${Math.round(agoH * 60)} min` : `${agoH.toFixed(1)} h`}`;
        const tags = g.tags.size ? ` (${[...g.tags].join(', ')})` : '';
        return `  – ${origin}${tags}: ${g.n}${lagTxt}${lastTxt}`;
      });
      return [head, ...parts].join('\n');
    } catch (e) {
      return `${rt}: perm=${has(rt) ? 'sim' : 'NÃO'} · ERRO ${e instanceof Error ? e.message : e}`;
    }
  };

  // Passos de hoje: soma crua × deduplicada. Se a crua for bem maior, há duas
  // fontes contando os mesmos passos (e o Askeo usa a deduplicada).
  const stepsLine = async (): Promise<string> => {
    const t0 = new Date(now);
    t0.setHours(0, 0, 0, 0);
    try {
      const recs = (await readAllRecords(m, 'Steps' as never, t0.toISOString(), nowISO)) as { count?: number }[];
      const raw = recs.reduce((a, r) => a + (r.count ?? 0), 0);
      const agg = await sumSteps(m, t0.toISOString(), nowISO);
      return `Passos hoje: ${agg.total} ${agg.deduped ? 'deduplicados' : '(sem deduplicação)'} · soma crua ${raw}${raw > agg.total * 1.2 && agg.deduped ? ' — há fontes duplicadas' : ''}`;
    } catch (e) {
      return `Passos hoje: ERRO ${e instanceof Error ? e.message : e}`;
    }
  };

  const lines = await Promise.all([
    probe('SleepSession', d2),
    probe('Weight', yearStart),
    probe('BodyFat', yearStart),
    probe('Steps', d2),
    probe('HeartRate', d2),
    probe('ExerciseSession', d2),
    stepsLine(),
  ]);
  return lines.join('\n');
}

// ————————————— Checklist de fontes (v1.106) —————————————

export interface SourceCheck {
  label: string;
  ok: boolean;
  detail: string;
}

/**
 * Checklist legível das fontes de dados (card Saúde): o que está chegando, de
 * onde e há quanto tempo. Substitui o "sem registro" genérico por um motivo.
 */
export async function getSourceChecklist(): Promise<SourceCheck[]> {
  const out: SourceCheck[] = [];
  const m = getModule();
  const available = await isHealthConnectAvailable();
  out.push({
    label: 'Health Connect',
    ok: available,
    detail: available ? 'instalado e disponível' : 'indisponível neste aparelho',
  });
  if (!m || !available || !(await ensureInit(m))) return out;

  const granted = await getGranted(m);
  const core = hasAll(granted, CORE_PERMISSIONS);
  const NAMES: Record<string, string> = {
    SleepSession: 'sono',
    ExerciseSession: 'treino',
    Steps: 'passos',
    HeartRate: 'FC',
    Weight: 'peso',
    BodyFat: 'gordura',
  };
  const missing = (list: Permission[]) =>
    list.filter((p) => !hasAll(granted, [p])).map((p) => NAMES[p.recordType] ?? p.recordType);
  const missingCore = missing(CORE_PERMISSIONS);
  const missingExtra = missing(EXTRA_PERMISSIONS);
  const hr = hasAll(granted, [{ accessType: 'read', recordType: 'HeartRate' }]);
  out.push({
    label: 'Permissões',
    ok: core,
    detail: !core
      ? `faltam ${missingCore.join(', ')}`
      : missingExtra.length
        ? `faltam ${missingExtra.join(', ')} (opcionais)`
        : 'sono, treino, passos, FC, peso e gordura',
  });
  if (!core) return out;

  const now = Date.now();
  const nowISO = new Date(now).toISOString();
  const since = new Date(now - 72 * 3600_000).toISOString();

  // Relógio: qualquer registro recente vindo das origens do relógio (ou marcado
  // como aparelho de pulso). É o teste de "a sincronização está viva?".
  let watchLast = 0;
  let watchVia = '';
  for (const rt of ['HeartRate', 'Steps', 'SleepSession', 'ExerciseSession']) {
    if (!granted.some((g) => g.recordType === rt)) continue;
    try {
      const recs = (await readAllRecords(m, rt as never, since, nowISO)) as {
        time?: string;
        endTime?: string;
        metadata?: RecordMeta;
      }[];
      for (const r of recs) {
        const origin = r.metadata?.dataOrigin ?? '';
        const wrist = [1, 4, 6].includes(r.metadata?.device?.type ?? 0);
        if (!WATCH_ORIGINS.includes(origin) && !wrist) continue;
        const t = new Date(r.endTime ?? r.time ?? 0).getTime();
        if (t > watchLast) {
          watchLast = t;
          watchVia = originLabel(origin);
        }
      }
    } catch {
      /* tipo sem permissão */
    }
  }
  const agoH = watchLast ? (now - watchLast) / 3600_000 : null;
  out.push({
    label: 'Relógio',
    ok: agoH != null && agoH < 12,
    detail:
      agoH == null
        ? 'nada do relógio nos últimos 3 dias — confira o Health Sync'
        : `último dado há ${agoH < 1 ? `${Math.round(agoH * 60)} min` : `${agoH.toFixed(1)} h`} (${watchVia})`,
  });

  // Sono da última noite.
  try {
    const res = await m.readRecords('SleepSession', {
      timeRangeFilter: { operator: 'between', startTime: new Date(now - 36 * 3600_000).toISOString(), endTime: nowISO },
    });
    const n = res.records.length;
    out.push({ label: 'Sono', ok: n > 0, detail: n > 0 ? 'última noite registrada' : 'nenhuma noite nas últimas 36 h' });
  } catch {
    out.push({ label: 'Sono', ok: false, detail: 'não foi possível ler' });
  }

  // Passos: deduplicação funcionando?
  try {
    const t0 = new Date(now);
    t0.setHours(0, 0, 0, 0);
    const agg = await sumSteps(m, t0.toISOString(), nowISO);
    out.push({
      label: 'Passos',
      ok: agg.deduped,
      detail: agg.deduped
        ? `${agg.total.toLocaleString('pt-BR')} hoje, sem contagem dupla`
        : `${agg.total.toLocaleString('pt-BR')} hoje (soma crua — pode estar em dobro)`,
    });
  } catch {
    out.push({ label: 'Passos', ok: false, detail: 'não foi possível ler' });
  }

  out.push({
    label: 'Frequência cardíaca',
    ok: hr,
    detail: hr ? 'liberada' : 'não liberada — zonas de FC ficam ocultas',
  });
  return out;
}

/**
 * Uma vez só (v1.106): regrava os últimos 30 dias de health_daily com passos e
 * treinos DEDUPLICADOS. Até a v1.105 a série somava relógio + celular e dobrava
 * os passos; sem isto a exportação misturaria dias inflados com dias corretos.
 */
export async function backfillHealthDailyOnce(): Promise<void> {
  const FLAG = 'health_daily_dedup_v106';
  try {
    if (await getKV(FLAG)) return;
    if (!(await hasHealthPermissions())) return; // tenta de novo quando houver
    await captureHealthDaily(30);
    await setKV(FLAG, new Date().toISOString());
  } catch (err) {
    console.warn('[health] backfill falhou:', err);
  }
}

/** Formata "6h30" a partir de minutos. */
export function formatSleepDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

/**
 * Resume o retrato de saúde numa frase curta para alimentar o contexto da
 * Askeo (coach). Retorna string vazia se não houver nada útil.
 */
export function formatHealthForCoach(s: HealthSnapshot): string {
  const parts: string[] = [];
  if (s.sleepMinutesLastNight != null) {
    parts.push(`dormiu ${formatSleepDuration(s.sleepMinutesLastNight)} na última noite`);
  }
  if (s.exerciseSessionsWeek > 0) {
    parts.push(
      `fez ${s.exerciseSessionsWeek} sessão(ões) de exercício (${s.exerciseMinutesWeek} min) nesta semana (desde segunda)`,
    );
  } else {
    parts.push('não registrou exercício nesta semana (desde segunda)');
  }
  if (s.zone2MinutesWeek != null && s.zone2MinutesWeek > 0) {
    parts.push(`${s.zone2MinutesWeek} min na semana em zona 2 (60–70% da FC máxima)`);
  }
  if (s.hrHighMinutesWeek != null && s.hrHighMinutesWeek > 0) {
    parts.push(`${s.hrHighMinutesWeek} min na semana com FC acima de 80% da máxima`);
  }
  if (s.stepsWeek > 0) parts.push(`${s.stepsWeek.toLocaleString('pt-BR')} passos na semana`);
  if (s.weightKg != null) parts.push(`peso ${s.weightKg} kg`);
  if (s.bodyFatPct != null) parts.push(`${s.bodyFatPct}% de gordura corporal`);
  return parts.join('; ');
}
