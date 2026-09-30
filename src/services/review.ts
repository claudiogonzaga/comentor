// FECHAMENTO DO DIA.
//
// A insistência muda de objetivo: não é mais "até a pessoa fazer", é "até a
// pessoa REGISTRAR" — fez, não fez, ou por quê. Um dia sem resposta é falha de
// coleta, e a análise externa precisa distinguir isso de "não fez".
//
// Este módulo sabe (1) o que ainda está sem resposta hoje, (2) quantos dias
// seguidos tiveram o registro completo e (3) quando mostrar a notificação
// "fechar o dia" — só se houver algo pendente, e só uma vez por dia.
//
// Não importa nudges.ts/medications.ts (eles importam isto): quem FECHA um item
// é a tela de revisão, chamando confirm*/skip* diretamente.

import * as Notifications from 'expo-notifications';
import { format } from 'date-fns';
import {
  getAllHabitStates,
  getDoneNudgeTypes,
  getKV,
  getLastAutomaticityDates,
  getUserConfig,
  listMedications,
  listNudges,
  recordAutomaticity,
  setKV,
} from './database';
import { ensureChannel } from './notifications';

export const REVIEW_TYPE = 'review';

// ——— AUTOMATICIDADE (v1.106) ———
// Uma pergunta por dia, no máximo, e cada hábito no máximo uma vez por semana:
// "faço sem pensar" (1–7), o item central do SRBAI (Gardner et al., 2012). É a
// medida direta de hábito formado — o que a contagem de "feitos" só adivinha.

const AUTOMATICITY_EVERY_DAYS = 7;

export interface AutomaticityQuestion {
  key: string;
  title: string;
}

/** O hábito a perguntar hoje (o de avaliação mais antiga), ou null. */
export async function getAutomaticityQuestion(): Promise<AutomaticityQuestion | null> {
  try {
    const today = isoOf(new Date());
    if ((await getKV('automaticity_asked')) === today) return null; // já perguntou hoje
    const last = await getLastAutomaticityDates();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - AUTOMATICITY_EVERY_DAYS);
    const cutoffISO = isoOf(cutoff);
    const candidates = (await listNudges())
      .filter((n) => n.enabled)
      .filter((n) => !last[n.type] || last[n.type] <= cutoffISO)
      .sort((a, b) => (last[a.type] ?? '').localeCompare(last[b.type] ?? ''));
    const n = candidates[0];
    return n ? { key: n.type, title: n.title } : null;
  } catch {
    return null;
  }
}

/** Grava a resposta (1–7) ou o "agora não" (score null): não pergunta de novo hoje. */
export async function answerAutomaticity(key: string, score: number | null): Promise<void> {
  const today = isoOf(new Date());
  try {
    if (score != null) await recordAutomaticity(key, today, score);
    await setKV('automaticity_asked', today);
  } catch (err) {
    console.warn('[review] automaticidade falhou:', err);
  }
}

export interface PendingItem {
  key: string;
  kind: 'nudge' | 'med';
  nudgeType?: string;
  medId?: number;
  title: string;
  time: string;
}

function isoOf(d: Date): string {
  return format(d, 'yyyy-MM-dd');
}

/** Chaves esperadas no dia: nudges habilitados (não formados) + remédios do dia da semana. */
async function expectedKeysFor(date: Date): Promise<{ key: string; item: PendingItem }[]> {
  const out: { key: string; item: PendingItem }[] = [];
  let formed = new Set<string>();
  try {
    formed = new Set((await getAllHabitStates()).filter((s) => s.state !== 'forming').map((s) => s.nudgeType));
  } catch {
    /* sem estados */
  }
  try {
    for (const n of await listNudges()) {
      if (!n.enabled || formed.has(n.type)) continue;
      out.push({
        key: n.type,
        item: { key: n.type, kind: 'nudge', nudgeType: n.type, title: n.title, time: n.scheduleTime },
      });
    }
  } catch {
    /* nudges opcionais */
  }
  try {
    const dow = date.getDay();
    for (const m of await listMedications()) {
      if (!m.enabled) continue;
      const days = m.daysOfWeek?.length ? m.daysOfWeek : [0, 1, 2, 3, 4, 5, 6];
      if (!days.includes(dow)) continue;
      const key = `med:${m.id}`;
      out.push({ key, item: { key, kind: 'med', medId: m.id, title: m.name, time: m.time } });
    }
  } catch {
    /* remédios opcionais */
  }
  return out;
}

/** Um item está RESPONDIDO se tem "feito" ou "não fiz" (:skip). :missed é sem resposta. */
function answered(done: Set<string>, key: string): boolean {
  return done.has(key) || done.has(`${key}:skip`);
}

/** Itens de hoje ainda sem resposta (feito ou não fiz). Inclui os já dados como :missed. */
export async function getPendingItemsToday(): Promise<PendingItem[]> {
  const today = new Date();
  const expected = await expectedKeysFor(today);
  let done = new Set<string>();
  try {
    done = new Set(await getDoneNudgeTypes(isoOf(today)));
  } catch {
    /* sem leitura: tudo pendente */
  }
  return expected.filter((e) => !answered(done, e.key)).map((e) => e.item);
}

/**
 * Dias seguidos (terminando ONTEM) em que todo item esperado teve resposta.
 * É a métrica de completude que aparece na Home — a insistência passa a ter
 * um placar próprio.
 */
export async function getCompleteDaysStreak(maxDays = 90): Promise<number> {
  let streak = 0;
  for (let i = 1; i <= maxDays; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const expected = await expectedKeysFor(d);
    if (expected.length === 0) {
      streak++;
      continue;
    }
    let done: Set<string>;
    try {
      done = new Set(await getDoneNudgeTypes(isoOf(d)));
    } catch {
      break;
    }
    if (expected.every((e) => answered(done, e.key))) streak++;
    else break;
  }
  return streak;
}

async function cancelReviewNotifications(): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  for (const s of scheduled) {
    const data = s.content.data as { type?: string };
    if (data?.type === REVIEW_TYPE) await Notifications.cancelScheduledNotificationAsync(s.identifier);
  }
}

/**
 * Agenda (ou cancela) a notificação "fechar o dia" de HOJE: só existe se há
 * itens sem resposta e o horário ainda não passou. Chamada a cada mudança de
 * estado (confirmar, pular, reagendar), então some sozinha quando tudo fecha.
 */
export async function refreshReviewNotification(): Promise<void> {
  try {
    await cancelReviewNotifications();
    const config = await getUserConfig();
    if (!config.reviewEnabled) return;
    const pending = await getPendingItemsToday();
    if (pending.length === 0) return;
    const [h, m] = config.reviewTime.split(':').map((s) => parseInt(s, 10));
    if (!Number.isFinite(h) || !Number.isFinite(m)) return;
    const at = new Date();
    at.setHours(h, m, 0, 0);
    if (at.getTime() <= Date.now()) return; // já passou: a Home continua mostrando o botão
    const channelId = await ensureChannel();
    const n = pending.length;
    await Notifications.scheduleNotificationAsync({
      content: {
        title: '🦉 Fechar o dia',
        body:
          n === 1
            ? `“${pending[0].title}” ficou sem resposta. Fez ou não fez? Um toque e pronto.`
            : `${n} itens de hoje estão sem resposta. Um toque em cada um e pronto.`,
        data: { type: REVIEW_TYPE },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at, channelId },
    });
  } catch (err) {
    console.warn('[review] refresh falhou:', err);
  }
}
