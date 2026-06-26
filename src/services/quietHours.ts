// Períodos de "não perturbe" para os AVISOS SONOROS. Substitui o antigo
// horário silencioso ÚNICO por uma LISTA de janelas (ex.: sono 22:00–07:00 +
// trabalho 09:00–18:00). Em qualquer janela ativa: as notificações vão para o
// canal SILENCIOSO (sem piado) e a voz (TTS) não fala.
//
// Fonte da verdade: app_kv 'quiet_periods_v1' (JSON). Migra automaticamente o
// horário silencioso legado (config.spokenQuiet*) na primeira leitura.

import { getKV, setKV, getUserConfig } from './database';

export interface QuietPeriod {
  start: string; // HH:MM
  end: string; // HH:MM
  days: number; // bitmask: bit d = dia d (0=domingo … 6=sábado); 127 = todos
}

const KV_KEY = 'quiet_periods_v1';

export function hhmmToMin(hhmm: string | undefined, fallback = 0): number {
  const p = (hhmm ?? '').split(':').map((s) => parseInt(s, 10));
  if (!Number.isFinite(p[0])) return fallback;
  return Math.min(23, Math.max(0, p[0])) * 60 + Math.min(59, Math.max(0, p[1] || 0));
}

function isValidPeriod(p: unknown): p is QuietPeriod {
  const q = p as QuietPeriod;
  return (
    !!q &&
    typeof q.start === 'string' &&
    typeof q.end === 'string' &&
    typeof q.days === 'number'
  );
}

/**
 * A janela `p` está ativa no minuto `min` do dia da semana `dow`? Cruzando a
 * meia-noite (start > end), conta como ativa de start até 24h e de 0h até end
 * (mesma regra do horário silencioso antigo — dia marcado vale a noite toda).
 */
export function periodActiveAt(p: QuietPeriod, min: number, dow: number): boolean {
  if (((p.days >> dow) & 1) === 0) return false;
  const s = hhmmToMin(p.start);
  const e = hhmmToMin(p.end);
  if (s === e) return false;
  return s < e ? min >= s && min < e : min >= s || min < e;
}

/** Alguma janela cobre esse minuto NESSE dia da semana? (DATE/WEEKLY). */
export function anyQuietAt(periods: QuietPeriod[], min: number, dow: number): boolean {
  return periods.some((p) => periodActiveAt(p, min, dow));
}

/** Alguma janela cobre esse minuto em QUALQUER dia? (para gatilhos DIÁRIOS). */
export function anyQuietAtMinute(periods: QuietPeriod[], min: number): boolean {
  return periods.some((p) => {
    if (p.days === 0) return false;
    const s = hhmmToMin(p.start);
    const e = hhmmToMin(p.end);
    if (s === e) return false;
    return s < e ? min >= s && min < e : min >= s || min < e;
  });
}

// ── Período de SONO (derivado do horário de dormir) ─────────────────────────
// Em vez de início/fim fixos, o usuário escolhe silenciar do horário de dormir
// por X horas (6–9…). A janela acompanha o bedtime automaticamente.
export interface SleepQuiet {
  enabled: boolean;
  hours: number; // duração em horas a partir do bedtime
}
const SLEEP_KEY = 'sleep_quiet_v1';
const DEFAULT_SLEEP: SleepQuiet = { enabled: false, hours: 8 };

function minToHhmm(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** A janela de sono derivada do bedtime + duração (days = todos os dias). */
export function deriveSleepPeriod(bedtime: string, hours: number): QuietPeriod {
  const startMin = hhmmToMin(bedtime, 23 * 60);
  const h = Math.min(14, Math.max(1, Math.round(hours)));
  return { start: minToHhmm(startMin), end: minToHhmm(startMin + h * 60), days: 127 };
}

export async function loadSleepQuiet(): Promise<SleepQuiet> {
  try {
    const raw = await getKV(SLEEP_KEY);
    if (raw != null) {
      const o = JSON.parse(raw);
      return {
        enabled: !!o?.enabled,
        hours: Number.isFinite(o?.hours) ? Math.min(14, Math.max(1, o.hours)) : 8,
      };
    }
  } catch {
    /* default */
  }
  return { ...DEFAULT_SLEEP };
}

export async function saveSleepQuiet(s: SleepQuiet): Promise<void> {
  await setKV(SLEEP_KEY, JSON.stringify({ enabled: !!s.enabled, hours: s.hours }));
  cache = null;
}

let cache: { list: QuietPeriod[]; at: number } | null = null;

export async function loadQuietPeriods(): Promise<QuietPeriod[]> {
  try {
    const raw = await getKV(KV_KEY);
    if (raw != null) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr.filter(isValidPeriod);
      return [];
    }
    // Sem chave ainda → migra o horário silencioso único (legado), se ativo.
    let migrated: QuietPeriod[] = [];
    try {
      const cfg = await getUserConfig();
      if (cfg.spokenQuietEnabled) {
        migrated = [
          {
            start: cfg.spokenQuietStart || '09:00',
            end: cfg.spokenQuietEnd || '18:00',
            days: cfg.spokenQuietDays ?? 127,
          },
        ];
      }
    } catch {
      /* sem config — começa vazio */
    }
    await setKV(KV_KEY, JSON.stringify(migrated));
    return migrated;
  } catch {
    return [];
  }
}

export async function saveQuietPeriods(list: QuietPeriod[]): Promise<void> {
  const clean = list.filter(isValidPeriod);
  await setKV(KV_KEY, JSON.stringify(clean));
  cache = { list: clean, at: Date.now() };
}

/** Lista EFETIVA = períodos manuais + janela de sono derivada (se ativa). */
export async function getEffectiveQuietPeriods(): Promise<QuietPeriod[]> {
  const manual = await loadQuietPeriods();
  const out = [...manual];
  try {
    const sleep = await loadSleepQuiet();
    if (sleep.enabled) {
      const cfg = await getUserConfig();
      out.push(deriveSleepPeriod(cfg.bedtime || '23:00', sleep.hours));
    }
  } catch {
    /* sem sono derivado */
  }
  return out;
}

/** Versão com cache curto (3s) para os caminhos quentes (agendamento). */
export async function getQuietPeriodsCached(): Promise<QuietPeriod[]> {
  if (cache && Date.now() - cache.at < 3000) return cache.list;
  const list = await getEffectiveQuietPeriods();
  cache = { list, at: Date.now() };
  return list;
}

/** Invalida o cache após salvar/editar de fora. */
export function invalidateQuietCache(): void {
  cache = null;
}

/** Estamos AGORA dentro de algum período de não-perturbe? */
export async function isQuietNow(): Promise<boolean> {
  const list = await getQuietPeriodsCached();
  const now = new Date();
  return anyQuietAt(list, now.getHours() * 60 + now.getMinutes(), now.getDay());
}
