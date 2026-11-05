// Aplica as respostas tocadas na notificação RIGOROSA (Fiz / Mais tempo / Não vou
// fazer). O nativo já parou a vibração na hora e guardou a resposta numa fila —
// mesmo com o app fechado. Aqui ela vira o mesmo que os botões das notificações
// comuns fazem: marca feito ou pulado (com o motivo), cancela as cobranças,
// registra o evento e avisa a sincronização com o Mac (notifyLocalChange, dentro
// de confirm/skip). Fica à parte de strictHabits.ts porque importa nudges.ts e
// medications.ts, que importam strictHabits.ts.
//
// Quando roda: no início do app, a cada volta ao primeiro plano e no instante em
// que o nativo avisa (com o JS vivo em segundo plano, o caso comum).

import { AppState } from 'react-native';
import { format } from 'date-fns';
import { confirmNudge, skipNudgeToday, snoozeNudge } from './nudges';
import { confirmMedication, skipMedicationToday, snoozeMedication } from './medications';
import { onStrictAnswer, takeStrictAnswers, type StrictAnswer } from './strictHabits';
import type { ConfirmMeta } from './habitEvents';

/** Só vale resposta a lembrete de hoje ou de ontem (o resto seria marcar o dia errado). */
function isRecentDay(day: string): boolean {
  const now = new Date();
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  return day === format(now, 'yyyy-MM-dd') || day === format(y, 'yyyy-MM-dd');
}

async function applyAnswer(a: StrictAnswer): Promise<void> {
  if (!isRecentDay(a.day)) return;
  const meta: ConfirmMeta = {
    via: 'notification',
    day: a.day,
    // A latência conta de quando a pessoa tocou, não de quando o app leu a fila.
    occurredAt: a.at,
    technique: 'rigoroso',
    reason: a.reason ?? null,
  };
  const isMed = a.key.startsWith('med:');
  const medId = isMed ? Number(a.key.slice(4)) : NaN;
  if (isMed && !Number.isFinite(medId)) return;

  if (a.action === 'done') {
    if (isMed) await confirmMedication(medId, meta);
    else await confirmNudge(a.key, meta);
  } else if (a.action === 'skip') {
    if (isMed) await skipMedicationToday(medId, meta);
    else await skipNudgeToday(a.key, meta);
  } else if (a.action === 'snooze') {
    // Adiamento que já venceu (app fechado esse tempo todo): o nativo já voltou a
    // insistir no fim dele — nada a reagendar.
    const until = a.until ?? 0;
    if (until <= Date.now()) return;
    if (isMed) await snoozeMedication(medId, 0, { until });
    else await snoozeNudge(a.key, 0, { until });
  }
}

let draining: Promise<void> | null = null;
let again = false;

/** Lê a fila do nativo e aplica cada resposta. Uma passada por vez. */
export function drainStrictAnswers(): Promise<void> {
  if (draining) {
    again = true;
    return draining;
  }
  const run = (async () => {
    do {
      again = false;
      for (const a of takeStrictAnswers()) {
        try {
          await applyAnswer(a);
        } catch (err) {
          console.warn('[strict] resposta não aplicada:', a.key, a.action, err);
        }
      }
    } while (again);
  })().finally(() => {
    draining = null;
    // Aviso que chegou entre o fim do laço e este finally: não pode se perder.
    if (again) {
      again = false;
      void drainStrictAnswers();
    }
  });
  draining = run;
  return run;
}

/** Liga a escuta das respostas (chamar uma vez, com o app pronto). Devolve o "desligar". */
export function startStrictAnswers(): () => void {
  void drainStrictAnswers();
  const offNative = onStrictAnswer(() => void drainStrictAnswers());
  const sub = AppState.addEventListener('change', (state) => {
    if (state === 'active') void drainStrictAnswers();
  });
  return () => {
    offNative();
    sub.remove();
  };
}
