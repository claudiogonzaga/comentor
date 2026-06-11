import { Platform } from 'react-native';
import type { Permission } from 'react-native-health-connect';
import { getUserConfig } from './database';

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
  { accessType: 'read', recordType: 'LeanBodyMass' },
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
   * (220 − idade). null = sem ano de nascimento, sem permissão ou sem dados.
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
  /** Massa magra mais recente, em kg (último ano). null = sem registro/permissão. */
  leanMassKg: number | null;
  /** % de gordura corporal mais recente (último ano). null = sem registro/permissão. */
  bodyFatPct: number | null;
}

function durationMinutes(startTime: string, endTime: string): number {
  return Math.max(0, (new Date(endTime).getTime() - new Date(startTime).getTime()) / 60000);
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

    const exercise = await m.readRecords('ExerciseSession', { timeRangeFilter: weekFilter });
    let exMin = 0;
    for (const r of exercise.records) exMin += durationMinutes(r.startTime, r.endTime);

    const steps = await m.readRecords('Steps', { timeRangeFilter: weekFilter });
    let stepsTotal = 0;
    for (const r of steps.records) stepsTotal += r.count ?? 0;

    // Passos de hoje: da meia-noite local até agora.
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);
    const stepsTodayRec = await m.readRecords('Steps', {
      timeRangeFilter: {
        operator: 'between',
        startTime: todayStart.toISOString(),
        endTime: nowISO,
      },
    });
    let stepsToday = 0;
    for (const r of stepsTodayRec.records) stepsToday += r.count ?? 0;

    // FC (semana): das MESMAS amostras saem DUAS métricas — minutos em ZONA 2
    // (~60–70% da FC máxima; base aeróbica) e minutos de ALTA intensidade
    // (>80%). Conta MINUTOS DISTINTOS com amostra na faixa — robusto a
    // amostragem irregular de relógio/pulseira. Precisa do ano de nascimento
    // para estimar a FC máxima (220 − idade).
    let hrHighMinutesWeek: number | null = null;
    let zone2MinutesWeek: number | null = null;
    try {
      const birthYear = (await getUserConfig()).birthYear;
      if (birthYear != null) {
        const age = Math.max(10, Math.min(110, now.getFullYear() - birthYear));
        const maxHr = 220 - age;
        const hrRecords = (await readAllRecords(
          m,
          'HeartRate' as never,
          weekStartISO,
          nowISO,
        )) as { samples?: { time: string; beatsPerMinute: number }[] }[];
        const highMinutes = new Set<number>();
        const zone2Minutes = new Set<number>();
        for (const rec of hrRecords) {
          for (const s of rec.samples ?? []) {
            const bpm = s.beatsPerMinute;
            const minute = Math.floor(new Date(s.time).getTime() / 60000);
            if (bpm > 0.8 * maxHr) highMinutes.add(minute);
            else if (bpm >= 0.6 * maxHr && bpm <= 0.7 * maxHr) zone2Minutes.add(minute);
          }
        }
        hrHighMinutesWeek = highMinutes.size;
        zone2MinutesWeek = zone2Minutes.size;
      }
    } catch {
      hrHighMinutesWeek = null; // sem permissão de FC — campos ficam ocultos
      zone2MinutesWeek = null;
    }

    // COMPOSIÇÃO CORPORAL: registro mais recente do último ano.
    const yearStart = new Date(now.getTime() - 365 * 24 * 3600_000).toISOString();
    let leanMassKg: number | null = null;
    try {
      const lean = (await m.readRecords('LeanBodyMass' as never, {
        timeRangeFilter: { operator: 'between', startTime: yearStart, endTime: nowISO },
        ascendingOrder: false,
        pageSize: 1,
      } as never)) as { records: { mass?: { inKilograms?: number } }[] };
      const kg = lean.records[0]?.mass?.inKilograms;
      if (typeof kg === 'number' && kg > 0) leanMassKg = Math.round(kg * 10) / 10;
    } catch {
      /* sem permissão/registro */
    }
    let bodyFatPct: number | null = null;
    try {
      const fat = (await m.readRecords('BodyFat' as never, {
        timeRangeFilter: { operator: 'between', startTime: yearStart, endTime: nowISO },
        ascendingOrder: false,
        pageSize: 1,
      } as never)) as { records: { percentage?: number }[] };
      const pct = fat.records[0]?.percentage;
      if (typeof pct === 'number' && pct > 0) bodyFatPct = Math.round(pct * 10) / 10;
    } catch {
      /* sem permissão/registro */
    }

    return {
      sleepMinutesLastNight,
      exerciseSessionsWeek: exercise.records.length,
      exerciseMinutesWeek: Math.round(exMin),
      hrHighMinutesWeek,
      zone2MinutesWeek,
      stepsWeek: stepsTotal,
      stepsToday,
      leanMassKg,
      bodyFatPct,
    };
  } catch {
    return null;
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
 * Comentora (coach). Retorna string vazia se não houver nada útil.
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
  if (s.leanMassKg != null) parts.push(`massa magra ${s.leanMassKg} kg`);
  if (s.bodyFatPct != null) parts.push(`${s.bodyFatPct}% de gordura corporal`);
  return parts.join('; ');
}
