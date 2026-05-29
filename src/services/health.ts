import { Platform } from 'react-native';
import type { Permission } from 'react-native-health-connect';

/**
 * Acesso aos dados de saúde do Android via Health Connect (substituto oficial
 * do Google Fit). Só lê: sono, sessões de exercício e passos.
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

/** As 3 permissões de leitura que pedimos. */
const READ_PERMISSIONS: Permission[] = [
  { accessType: 'read', recordType: 'SleepSession' },
  { accessType: 'read', recordType: 'ExerciseSession' },
  { accessType: 'read', recordType: 'Steps' },
];

let initialized = false;
async function ensureInit(m: HealthConnectModule): Promise<boolean> {
  if (initialized) return true;
  try {
    initialized = await m.initialize();
    return initialized;
  } catch {
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

function hasAll(
  granted: { accessType?: string; recordType?: string }[],
): boolean {
  return READ_PERMISSIONS.every((p) =>
    granted.some(
      (g) => g.accessType === p.accessType && g.recordType === p.recordType,
    ),
  );
}

/** Já temos as 3 permissões de leitura concedidas? (não abre prompt) */
export async function hasHealthPermissions(): Promise<boolean> {
  const m = getModule();
  if (!m || !(await ensureInit(m))) return false;
  try {
    const granted = await m.getGrantedPermissions();
    return hasAll(granted as { accessType?: string; recordType?: string }[]);
  } catch {
    return false;
  }
}

/**
 * Abre o fluxo de permissão do Health Connect e devolve se TODAS as leituras
 * foram concedidas. Seguro chamar mesmo sem o app Health Connect — retorna
 * false em vez de lançar.
 */
export async function requestHealthPermissions(): Promise<boolean> {
  const m = getModule();
  if (!m || !(await ensureInit(m))) return false;
  try {
    const granted = await m.requestPermission(READ_PERMISSIONS);
    return hasAll(granted as { accessType?: string; recordType?: string }[]);
  } catch {
    return false;
  }
}

/** Abre as configurações do Health Connect (gerenciar permissões/dados). */
export async function openHealthSettings(): Promise<void> {
  const m = getModule();
  if (!m) return;
  try {
    await m.openHealthConnectSettings();
  } catch {
    /* best-effort */
  }
}

export interface HealthSnapshot {
  /** Minutos dormidos na última noite (≈ últimas 18h), ou null se sem registro. */
  sleepMinutesLastNight: number | null;
  /** Nº de sessões de exercício nos últimos 7 dias. */
  exerciseSessions7d: number;
  /** Minutos totais de exercício nos últimos 7 dias. */
  exerciseMinutes7d: number;
  /** Passos somados nos últimos 7 dias. */
  steps7d: number;
}

function durationMinutes(startTime: string, endTime: string): number {
  return Math.max(0, (new Date(endTime).getTime() - new Date(startTime).getTime()) / 60000);
}

/**
 * Lê um retrato dos dados de saúde. Retorna null se Health Connect não estiver
 * disponível ou sem permissão — nunca lança.
 */
export async function getHealthSnapshot(): Promise<HealthSnapshot | null> {
  const m = getModule();
  if (!m || !(await ensureInit(m))) return null;
  if (!(await hasHealthPermissions())) return null;

  try {
    const now = new Date();
    const nowISO = now.toISOString();

    // Sono: janela das últimas 18h cobre a noite anterior para quem abre o app
    // de dia. Soma a duração de todas as sessões na janela.
    const sleepStart = new Date(now.getTime() - 18 * 3600_000).toISOString();
    const sleep = await m.readRecords('SleepSession', {
      timeRangeFilter: { operator: 'between', startTime: sleepStart, endTime: nowISO },
    });
    let sleepMin = 0;
    for (const r of sleep.records) sleepMin += durationMinutes(r.startTime, r.endTime);
    const sleepMinutesLastNight = sleep.records.length ? Math.round(sleepMin) : null;

    // Exercício + passos: últimos 7 dias.
    const weekStart = new Date(now.getTime() - 7 * 24 * 3600_000).toISOString();
    const weekFilter = { operator: 'between' as const, startTime: weekStart, endTime: nowISO };

    const exercise = await m.readRecords('ExerciseSession', { timeRangeFilter: weekFilter });
    let exMin = 0;
    for (const r of exercise.records) exMin += durationMinutes(r.startTime, r.endTime);

    const steps = await m.readRecords('Steps', { timeRangeFilter: weekFilter });
    let stepsTotal = 0;
    for (const r of steps.records) stepsTotal += r.count ?? 0;

    return {
      sleepMinutesLastNight,
      exerciseSessions7d: exercise.records.length,
      exerciseMinutes7d: Math.round(exMin),
      steps7d: stepsTotal,
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
  if (s.exerciseSessions7d > 0) {
    parts.push(
      `fez ${s.exerciseSessions7d} sessão(ões) de exercício (${s.exerciseMinutes7d} min) nos últimos 7 dias`,
    );
  } else {
    parts.push('não registrou exercício nos últimos 7 dias');
  }
  if (s.steps7d > 0) parts.push(`${s.steps7d.toLocaleString('pt-BR')} passos na semana`);
  return parts.join('; ');
}
