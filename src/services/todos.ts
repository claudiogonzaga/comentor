import {
  getDoneNudgeTypes,
  listMedications,
  listNudges,
} from './database';
import { confirmNudge, unconfirmNudge } from './nudges';
import { confirmMedication, unconfirmMedication } from './medications';
import type { GreekIconName } from '../components/GreekIcon';

/**
 * Lista de tarefas do dia para a tela inicial. Reúne os nudges (lembretes
 * diários de hábitos) e os medicamentos/suplementos habilitados, marcando
 * cada item como concluído com base em `nudge_completions` de hoje.
 *
 * Quando o usuário toca um item, alternamos o "feito" com
 * confirm/unconfirm, que também reagendam as insistências do dia.
 */

export interface TodoItem {
  /** Chave estável usada em nudge_completions: o `type` do nudge ou `med:<id>`. */
  key: string;
  kind: 'nudge' | 'med';
  /** id numérico (medicamento) ou o `type` string (nudge), p/ confirm/unconfirm. */
  nudgeType?: string;
  medId?: number;
  title: string;
  /** Subtítulo opcional (corpo do nudge ou dosagem do medicamento). */
  subtitle?: string;
  time: string; // HH:MM
  icon: GreekIconName;
  done: boolean;
  /** Marcado como "Não vou fazer hoje" (resolvido, mas não conta como feito). */
  skipped?: boolean;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

/**
 * Mapeia os emojis usados nos lembretes para os ícones gregos (preto sobre
 * terracota). Mantém a estética sem emojis coloridos. Fallback sensato por
 * tipo de item.
 */
export function iconForEmoji(emoji: string | null | undefined, kind: 'nudge' | 'med'): GreekIconName {
  switch (emoji) {
    case '🕶️':
    case '🌇':
      return 'sunset';
    case '🌬️':
    case '💨':
      return 'wind';
    case '🌙':
    case '🌛':
      return 'moon';
    case '💊':
    case '💉':
    case '🧪':
      return 'pill';
    case '🌿':
    case '🍵':
    case '🥗':
      return 'leaf';
    case '💧':
    case '🫗':
    case '🚰':
      return 'drop';
    case '🍲':
    case '🥣':
    case '🍽️':
      return 'bowl';
    case '⏳':
    case '⌛':
      return 'fasting';
    case '☕':
      return 'coffee';
    case '🏃':
    case '🏃‍♂️':
    case '🚶':
      return 'footsteps';
    case '🏋️':
    case '💪':
      return 'activity';
    case '☀️':
    case '🌞':
      return 'sun';
    case '🔔':
      return 'bell';
    default:
      return kind === 'med' ? 'pill' : 'leaf';
  }
}

/** Ordena por horário HH:MM crescente; itens sem horário válido vão ao fim. */
function timeToMinutes(time: string): number {
  const parts = time.split(':').map((s) => parseInt(s, 10));
  const h = parts[0];
  const m = parts[1] ?? 0;
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 24 * 60 + 1;
  return h * 60 + m;
}

/**
 * Constrói a lista de tarefas de hoje (nudges + medicamentos habilitados),
 * já com o estado de concluído. Ordenada por horário.
 */
export async function getTodayTodos(): Promise<TodoItem[]> {
  const today = todayISO();

  let doneKeys: string[] = [];
  try {
    doneKeys = await getDoneNudgeTypes(today);
  } catch {
    /* treat nothing as done if the read fails */
  }
  const done = new Set(doneKeys);

  const items: TodoItem[] = [];

  try {
    const nudges = await listNudges();
    for (const n of nudges) {
      if (!n.enabled) continue;
      items.push({
        key: n.type,
        kind: 'nudge',
        nudgeType: n.type,
        title: n.title,
        subtitle: n.body || undefined,
        time: n.scheduleTime,
        icon: iconForEmoji(n.emoji, 'nudge'),
        done: done.has(n.type) || done.has(`${n.type}:skip`),
        skipped: done.has(`${n.type}:skip`) && !done.has(n.type),
      });
    }
  } catch {
    /* nudges optional */
  }

  try {
    const meds = await listMedications();
    const todayDow = new Date().getDay(); // 0=domingo … 6=sábado
    for (const med of meds) {
      if (!med.enabled) continue;
      // Lembretes semanais só aparecem na lista de hoje nos dias selecionados.
      const days = med.daysOfWeek?.length ? med.daysOfWeek : [0, 1, 2, 3, 4, 5, 6];
      if (!days.includes(todayDow)) continue;
      const key = `med:${med.id}`;
      let subtitle = med.dosage?.trim() || undefined;
      if (med.fastingHours != null) {
        const fastH = Math.min(23, Math.max(1, Math.round(med.fastingHours)));
        const tp = med.time.split(':').map((s) => parseInt(s, 10));
        const firstMin = (tp[0] || 0) * 60 + (tp[1] || 0);
        const endMin = (firstMin + (24 - fastH) * 60) % (24 * 60);
        const fmt = (mins: number) =>
          `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
        subtitle = `Comer ${med.time}–${fmt(endMin)} · jejum de ${fastH}h`;
      }
      items.push({
        key,
        kind: 'med',
        medId: med.id,
        title: med.name,
        subtitle,
        time: med.time,
        icon: iconForEmoji(med.emoji, 'med'),
        done: done.has(key) || done.has(`${key}:skip`),
        skipped: done.has(`${key}:skip`) && !done.has(key),
      });
    }
  } catch {
    /* meds optional */
  }

  items.sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));
  return items;
}

/**
 * Alterna o estado "feito" de um item. Quando marca, encerra as insistências
 * de hoje; quando desmarca, recria a corrente do dia. Retorna o novo estado.
 */
export async function toggleTodo(item: TodoItem): Promise<boolean> {
  const next = !item.done;
  if (item.kind === 'nudge' && item.nudgeType) {
    if (next) await confirmNudge(item.nudgeType);
    else await unconfirmNudge(item.nudgeType);
  } else if (item.kind === 'med' && item.medId != null) {
    if (next) await confirmMedication(item.medId);
    else await unconfirmMedication(item.medId);
  }
  return next;
}
