// Camada JS sobre o módulo nativo SpokenNudges.
//
// Fluxo: pré-renderiza o áudio (voz Gemini) de cada mensagem AGORA (app aberto,
// com internet), salva o WAV persistente, e agenda um alarme exato nativo que,
// ao disparar (tela apagada / app fechado), inicia um foreground service que
// TOCA o WAV. O disparo não depende de rede nem de JS.
//
// Requer chave Gemini (sem ela não há como pré-renderizar uma voz boa).

import { Platform } from 'react-native';
import { requireNativeModule } from 'expo-modules-core';
import { prepareReadAloudAudio } from './voice';
import { getUserConfig } from './database';
import { getApiKey } from './secureStore';

interface SpokenNudgesNative {
  isExactAlarmAllowed(): boolean;
  openExactAlarmSettings(): void;
  isIgnoringBatteryOptimizations(): boolean;
  requestIgnoreBatteryOptimizations(): void;
  schedule(
    id: string,
    atEpochMs: number,
    audioPath: string,
    repeatDaily: boolean,
    title: string,
    body: string,
  ): Promise<void>;
  cancel(id: string): Promise<void>;
  cancelAll(): Promise<void>;
  scheduledIds(): string[];
  rearmAll(): Promise<void>;
}

let native: SpokenNudgesNative | null = null;
try {
  if (Platform.OS === 'android') {
    native = requireNativeModule<SpokenNudgesNative>('SpokenNudges');
  }
} catch {
  // Módulo nativo ausente (Expo Go / web / build sem o módulo) → recurso indisponível.
  native = null;
}

/** O recurso de fala em background está disponível neste build/plataforma? */
export function spokenNudgesAvailable(): boolean {
  return !!native;
}

const PREFIX = 'spk_';
const INSP_PREFIX = `${PREFIX}insp_`;
const TEST_ID = `${PREFIX}test`;

// ---- permissões (no-ops seguros se o módulo não existir) ----

export function isExactAlarmAllowed(): boolean {
  try {
    return native ? native.isExactAlarmAllowed() : false;
  } catch {
    return false;
  }
}

export function openExactAlarmSettings(): void {
  try {
    native?.openExactAlarmSettings();
  } catch {
    /* ignore */
  }
}

export function isIgnoringBatteryOptimizations(): boolean {
  try {
    return native ? native.isIgnoringBatteryOptimizations() : false;
  } catch {
    return false;
  }
}

export function requestIgnoreBatteryOptimizations(): void {
  try {
    native?.requestIgnoreBatteryOptimizations();
  } catch {
    /* ignore */
  }
}

// ---- agendamento ----

function nextDailyEpoch(hour: number, minute: number): number {
  const now = new Date();
  const d = new Date(now);
  d.setHours(hour, minute, 0, 0);
  if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
  return d.getTime();
}

async function configuredVoice(): Promise<string> {
  try {
    const c = await getUserConfig();
    return c.readAloudGeminiVoice || 'Aoede';
  } catch {
    return 'Aoede';
  }
}

/**
 * Agenda um alarme falado de TESTE daqui a `seconds`. Ótimo para validar o
 * mecanismo: agendar, travar a tela / fechar o app, e ouvir a Comentora falar.
 */
export async function scheduleSpokenTest(
  seconds = 60,
): Promise<{ ok: boolean; reason?: string }> {
  if (!native) return { ok: false, reason: 'recurso indisponível neste aparelho' };
  const key = await getApiKey();
  if (!key) return { ok: false, reason: 'configure a chave do Gemini primeiro' };
  const voice = await configuredVoice();
  const text =
    'Oi! Aqui é a Comentora, falando com você em voz alta — mesmo com a tela apagada. ' +
    'Se você está ouvindo isto, os lembretes falados estão funcionando.';
  let uri: string | null = null;
  try {
    uri = await prepareReadAloudAudio(text, { geminiVoiceName: voice });
  } catch (e) {
    return { ok: false, reason: (e as Error)?.message ?? 'falha ao gerar áudio' };
  }
  if (!uri) return { ok: false, reason: 'falha ao gerar áudio' };
  try {
    await native.schedule(TEST_ID, Date.now() + seconds * 1000, uri, false, 'Comentora', text);
  } catch (e) {
    return { ok: false, reason: (e as Error)?.message ?? 'falha ao agendar' };
  }
  return { ok: true };
}

/**
 * Sincroniza os alarmes falados das INSPIRAÇÕES com a lista (texto + horário).
 * Cancela os antigos e re-cria conforme a config. Best-effort: se um trecho
 * falhar (cota/rede), os outros seguem. Chamado por scheduleInspirationNotifications.
 */
export async function syncSpokenInspirations(
  items: { text: string; hour: number; minute: number }[],
): Promise<void> {
  if (!native) return;

  // remove os alarmes falados de inspiração anteriores
  try {
    for (const id of native.scheduledIds()) {
      if (id.startsWith(INSP_PREFIX)) await native.cancel(id);
    }
  } catch {
    /* ignore */
  }

  let enabled = false;
  let voice = 'Aoede';
  try {
    const c = await getUserConfig();
    enabled = !!c.spokenNudgesEnabled && !!c.inspirationModeEnabled;
    voice = c.readAloudGeminiVoice || 'Aoede';
  } catch {
    return;
  }
  if (!enabled) return;

  const key = await getApiKey();
  if (!key) return; // sem Gemini não dá pra pré-renderizar uma voz boa

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    try {
      const uri = await prepareReadAloudAudio(it.text, { geminiVoiceName: voice });
      if (!uri) continue;
      await native.schedule(
        `${INSP_PREFIX}${i}`,
        nextDailyEpoch(it.hour, it.minute),
        uri,
        true,
        'Comentora',
        it.text,
      );
    } catch {
      // segue para os próximos
    }
  }
}

/** Cancela TODOS os alarmes falados (ao desligar o recurso). */
export async function cancelAllSpoken(): Promise<void> {
  try {
    await native?.cancelAll();
  } catch {
    /* ignore */
  }
}

/** Re-arma os alarmes persistidos (chamar no launch do app, além do boot). */
export async function rearmSpoken(): Promise<void> {
  try {
    await native?.rearmAll();
  } catch {
    /* ignore */
  }
}
