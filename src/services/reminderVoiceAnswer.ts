// Resposta por VOZ ao lembrete: depois que a Comentora fala a cobrança, ela
// lista as opções e ABRE O MICROFONE para o usuário responder falando:
//   "a" / "já fiz" / "já tomei"      → marca como feito
//   "b" / "mais tempo" / "depois"    → adia (snoozeMinutes)
//   "c" / "não vou hoje" / "pular"   → pula hoje (sem contar como feito)
// A Comentora confirma em voz o que entendeu. Se não entender, orienta a usar
// os botões da notificação (nada é marcado por engano).
//
// Limite honesto: o microfone só abre com o APP EM PRIMEIRO PLANO — o Android
// não permite um serviço em background abrir o mic de forma confiável.

import { speak, startListening, stopListening } from './voice';
import { confirmNudge, snoozeNudge, skipNudgeToday } from './nudges';
import { confirmMedication, snoozeMedication, skipMedicationToday } from './medications';

export type ReminderRef =
  | { kind: 'med'; medId: number }
  | { kind: 'nudge'; nudgeType: string };

export type VoiceAnswer = 'done' | 'snooze' | 'skip';

/** Fala e RESOLVE quando terminar de falar (speak resolve antes do fim). */
function speakAsync(text: string, volume?: number): Promise<void> {
  return new Promise((resolve) => {
    void speak(text, { volume, onDone: resolve, onError: () => resolve() });
  });
}

/**
 * Interpreta a fala. Letras soltas só valem quando são a resposta inteira
 * ("a", "opção b", "letra c") — senão o artigo "a" no meio da frase marcaria
 * feito sem querer. Frases têm prioridade.
 */
export function parseVoiceAnswer(raw: string): VoiceAnswer | null {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/[.,!?;:]/g, '')
    .replace(/\s+/g, ' ');
  if (!s) return null;
  // frases (prioridade sobre letras)
  if (/(já|ja) (fiz|tomei|feito)|acabei de|tomei sim|fiz sim|\bfeito\b|conclu[íi]/.test(s)) return 'done';
  if (/mais tempo|depois|adiar|daqui a pouco|ainda n[ãa]o|me d[êe] (um )?tempo|mais tarde/.test(s)) return 'snooze';
  if (/n[ãa]o vou|hoje n[ãa]o|pular|deixa pra amanh[ãa]|amanh[ãa] eu/.test(s)) return 'skip';
  // letras/opções isoladas
  if (s === 'a' || s === 'á' || s === 'opção a' || s === 'opcao a' || s === 'letra a') return 'done';
  if (s === 'b' || s === 'bê' || s === 'be' || s === 'opção b' || s === 'opcao b' || s === 'letra b') return 'snooze';
  if (s === 'c' || s === 'cê' || s === 'opção c' || s === 'opcao c' || s === 'letra c') return 'skip';
  if (s === 'sim') return 'done';
  return null;
}

/** Ouve UMA resposta (até `timeoutMs`); devolve o transcript final ('' se nada). */
function listenOnce(timeoutMs = 9000): Promise<string> {
  return new Promise((resolve) => {
    let settled = false;
    let heard = '';
    let stopFn: (() => void) | null = null;
    const finish = (text: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        stopFn?.();
      } catch {
        /* noop */
      }
      void stopListening();
      resolve(text.trim());
    };
    const timer = setTimeout(() => finish(heard), timeoutMs);
    void startListening({
      onResult: (transcript, isFinal) => {
        if (transcript) heard = transcript;
        if (isFinal && transcript) finish(transcript);
      },
      onError: () => finish(heard),
      onEnd: () => finish(heard),
    }).then((stop) => {
      stopFn = stop;
      if (settled) stop();
    });
  });
}

const OPTIONS_PROMPT =
  'Pode responder por voz: a: já fiz. b: preciso de mais tempo. c: não vou fazer hoje.';

/**
 * Fala as opções, abre o microfone, interpreta e EXECUTA a resposta.
 * Retorna a resposta aplicada, ou null se não entendeu / silêncio.
 */
export async function askAndHandleVoiceAnswer(
  ref: ReminderRef,
  opts: { snoozeMinutes: number; volume?: number },
): Promise<VoiceAnswer | null> {
  const vol = opts.volume;
  await speakAsync(OPTIONS_PROMPT, vol);
  const heard = await listenOnce(9000);
  const answer = heard ? parseVoiceAnswer(heard) : null;

  if (!answer) {
    if (heard) {
      await speakAsync('Não entendi. Pode marcar pelos botões da notificação.', vol);
    }
    return null;
  }

  try {
    if (answer === 'done') {
      if (ref.kind === 'med') await confirmMedication(ref.medId);
      else await confirmNudge(ref.nudgeType);
      await speakAsync('Perfeito! Marquei como feito.', vol);
    } else if (answer === 'snooze') {
      const min = Math.max(1, opts.snoozeMinutes);
      if (ref.kind === 'med') await snoozeMedication(ref.medId, min);
      else await snoozeNudge(ref.nudgeType, min);
      await speakAsync(`Combinado, te lembro de novo em ${min} minutos.`, vol);
    } else {
      if (ref.kind === 'med') await skipMedicationToday(ref.medId);
      else await skipNudgeToday(ref.nudgeType);
      await speakAsync('Tudo bem, fica para amanhã.', vol);
    }
  } catch {
    /* marcação best-effort; os botões continuam disponíveis */
  }
  return answer;
}
