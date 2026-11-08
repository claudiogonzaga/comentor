// MIGRAÇÃO para o APP DE HÁBITOS (v1.130), uma vez só.
//
// 1. "Meus hábitos" (tabela medications) se divide: remédio, suplemento, jejum e
//    lembrete avulso continuam LEMBRETES; o resto (água, comida, café, manhã, luz
//    azul, respiração, exercício, noite) vira HÁBITO, com o histórico. Um cartão
//    na Home mostra a divisão e deixa mover cada item.
// 2. O "formado" antigo (14 dos últimos 16 dias) só fica se a força nova — a que
//    a pesquisa sustenta — já for de hábito formado (≥ 90%). Senão o hábito volta a
//    "em formação", na fase que a força mandar (em geral, só o aviso na hora).

import { format } from 'date-fns';
import { getHabitState, getKV, listMedications, setHabitState, setKV } from './database';
import { ensureHabitSchema, getMarksOf, getValuesOf, listHabitRows, listSrbaiRows } from './habitDb';
import { computeStats } from './habitStrength';
import { GRADUATE_STRENGTH } from './habitStage';
import { convertReminderToHabit, MIGRATION_REVIEW_KV } from './habitos';

const MIGRATED_KV = 'habitos_v1_migrated';

/** Ícones que dizem "isto é lembrete, não hábito": remédio, suplemento, jejum, lembrete. */
const REMINDER_EMOJIS = new Set(['💊', '💉', '🧪', '🌿', '⏳', '⌛', '🔔']);

let running: Promise<void> | null = null;

export function migrateHabitsV1(): Promise<void> {
  if (!running) {
    running = run().catch((err) => {
      console.warn('[habitMigration] falhou:', err);
    }).finally(() => {
      running = null;
    });
  }
  return running;
}

async function run(): Promise<void> {
  if (await getKV(MIGRATED_KV)) return;
  await ensureHabitSchema();
  const today = format(new Date(), 'yyyy-MM-dd');

  // 2) o "formado" antigo
  for (const def of await listHabitRows(true)) {
    const st = await getHabitState(def.type);
    if (st.state === 'forming') continue;
    const c = computeStats({
      def,
      marks: await getMarksOf(def.type),
      values: await getValuesOf(def.type),
      srbai: await listSrbaiRows(def.type),
      formed: false,
      today,
    });
    if (c.strength < GRADUATE_STRENGTH) {
      await setHabitState({ ...st, state: 'forming', formedAt: null, sampleMisses: 0, lastSampleAt: null });
    }
  }

  // 1) "Meus hábitos" → hábitos ou lembretes
  const habits: string[] = [];
  const reminders: number[] = [];
  for (const med of await listMedications()) {
    const isReminder = med.fastingHours != null || !med.emoji || REMINDER_EMOJIS.has(med.emoji);
    if (isReminder) {
      reminders.push(med.id);
      continue;
    }
    try {
      habits.push(await convertReminderToHabit(med.id));
    } catch (err) {
      console.warn('[habitMigration] não converteu', med.id, err);
      reminders.push(med.id);
    }
  }
  if (habits.length) await setKV(MIGRATION_REVIEW_KV, JSON.stringify({ habits, reminders }));
  await setKV(MIGRATED_KV, today);
}
