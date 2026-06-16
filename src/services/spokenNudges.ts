// Camada JS sobre o módulo nativo SpokenNudges.
//
// Fluxo: pré-renderiza o áudio (voz Gemini) de cada mensagem AGORA (app aberto,
// com internet), salva o WAV persistente, e agenda um alarme exato nativo que,
// ao disparar (tela apagada / app fechado), inicia um foreground service que
// TOCA o WAV. O disparo não depende de rede nem de JS.
//
// Voz: se o provider global for "gemini" e houver chave, pré-renderiza o WAV na
// voz do Gemini (render-1x + cache → não gasta cota se texto+voz não mudaram).
// Sem chave / provider "system" / falha de cota: cai na VOZ DO SISTEMA (o serviço
// nativo fala o texto). O nudge SEMPRE acontece — só muda a voz.

import { Platform } from 'react-native';
import { requireNativeModule } from 'expo-modules-core';
import { getUserConfig } from './database';
import { getApiKey } from './secureStore';
import { prepareNudgeAudio, cleanupNudgeAudio, DEFAULT_GEMINI_VOICE } from './geminiTTS';

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
  setHeadphonesOnly(enabled: boolean): void;
  isHeadphonesConnected(): boolean;
  setQuietHours(enabled: boolean, startMin: number, endMin: number, daysMask: number): void;
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
const MED_SPOKEN_PREFIX = `${PREFIX}med_`;
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

/**
 * Define a preferência "só falar com fone de ouvido". Mirror para o nativo (que
 * lê na hora do disparo, sem o JS). Chamar quando a config muda e no init.
 */
export function setSpokenHeadphonesOnly(enabled: boolean): void {
  try {
    native?.setHeadphonesOnly(enabled);
  } catch {
    /* ignore */
  }
}

/** Há um fone de ouvido conectado AGORA? (para a UI explicar o estado). */
export function isHeadphonesConnected(): boolean {
  try {
    return native ? native.isHeadphonesConnected() : false;
  } catch {
    return false;
  }
}

interface QuietConfig {
  spokenQuietEnabled?: boolean;
  spokenQuietStart?: string; // HH:MM
  spokenQuietEnd?: string; // HH:MM
  spokenQuietDays?: number; // bitmask 0–6
}

function hhmmToMin(hhmm: string | undefined, fallback: number): number {
  const p = (hhmm ?? '').split(':').map((s) => parseInt(s, 10));
  if (!Number.isFinite(p[0])) return fallback;
  return Math.min(23, Math.max(0, p[0])) * 60 + Math.min(59, Math.max(0, p[1] || 0));
}

/** Mirror do horário silencioso para o nativo (que o lê no disparo do alarme). */
export function setSpokenQuietHours(cfg: QuietConfig): void {
  try {
    native?.setQuietHours(
      !!cfg.spokenQuietEnabled,
      hhmmToMin(cfg.spokenQuietStart, 9 * 60),
      hhmmToMin(cfg.spokenQuietEnd, 18 * 60),
      cfg.spokenQuietDays ?? 127,
    );
  } catch {
    /* ignore */
  }
}

/** Estamos AGORA dentro do horário silencioso? (gate da fala em primeiro plano). */
export function isSpokenQuietNow(cfg: QuietConfig | null | undefined): boolean {
  if (!cfg?.spokenQuietEnabled) return false;
  const now = new Date();
  const days = cfg.spokenQuietDays ?? 127;
  if (((days >> now.getDay()) & 1) === 0) return false;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const start = hhmmToMin(cfg.spokenQuietStart, 9 * 60);
  const end = hhmmToMin(cfg.spokenQuietEnd, 18 * 60);
  return start <= end ? nowMin >= start && nowMin < end : nowMin >= start || nowMin < end;
}

// ---- agendamento ----

function nextDailyEpoch(hour: number, minute: number): number {
  const now = new Date();
  const d = new Date(now);
  d.setHours(hour, minute, 0, 0);
  if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/**
 * Agenda um disparo ÚNICO falado em `atEpochMs`. Tenta gerar o áudio na voz do
 * Gemini AGORA (se o provider global for "gemini" e houver chave); em falha ou
 * sem Gemini, agenda com o texto → o serviço fala na VOZ DO SISTEMA. É a base
 * comum do teste e do gancho JITAI.
 */
async function scheduleSpokenOneShot(
  id: string,
  text: string,
  atEpochMs: number,
  title = 'Comentora',
): Promise<{ ok: boolean; usedGemini: boolean }> {
  if (!native) return { ok: false, usedGemini: false };
  const trimmed = (text || '').trim();
  if (!trimmed) return { ok: false, usedGemini: false };

  let audioPath = '';
  let usedGemini = false;
  try {
    const c = await getUserConfig();
    if (c.voiceProvider === 'gemini') {
      const voiceName = c.geminiVoiceName || DEFAULT_GEMINI_VOICE;
      // texto dinâmico → cache efêmero (sem persist); dispara em segundos
      const { uri } = await prepareNudgeAudio(trimmed, { voiceName });
      audioPath = uri;
      usedGemini = true;
    }
  } catch {
    audioPath = ''; // sem chave / cota / rede → voz do sistema
  }
  try {
    await native.schedule(id, atEpochMs, audioPath, false, title, trimmed);
  } catch {
    return { ok: false, usedGemini };
  }
  return { ok: true, usedGemini };
}

/**
 * Agenda um alarme falado de TESTE daqui a `seconds`. Ótimo para validar o
 * mecanismo: agendar, travar a tela / fechar o app, e ouvir a Comentora falar.
 * Usa a MESMA voz que os nudges (Gemini se configurado; senão, voz do sistema).
 */
export async function scheduleSpokenTest(
  seconds = 60,
): Promise<{ ok: boolean; reason?: string }> {
  if (!native) return { ok: false, reason: 'recurso indisponível neste aparelho' };
  const text =
    'Oi! Aqui é a Comentora, falando com você em voz alta — mesmo com a tela apagada. ' +
    'Se você está ouvindo isto, os lembretes falados estão funcionando.';
  const r = await scheduleSpokenOneShot(TEST_ID, text, Date.now() + seconds * 1000);
  return r.ok ? { ok: true } : { ok: false, reason: 'falha ao agendar' };
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
  let useGemini = false;
  let voiceName = DEFAULT_GEMINI_VOICE;
  try {
    const c = await getUserConfig();
    enabled = !!c.spokenNudgesEnabled && !!c.inspirationModeEnabled && !c.silentMode;
    useGemini = c.voiceProvider === 'gemini';
    voiceName = c.geminiVoiceName || DEFAULT_GEMINI_VOICE;
  } catch {
    return;
  }
  if (!enabled) return;

  // Pré-render na voz do Gemini só se o provider global for "gemini" E houver
  // chave; senão, voz do sistema.
  let renderGemini = useGemini;
  if (renderGemini) {
    try {
      renderGemini = !!(await getApiKey());
    } catch {
      renderGemini = false;
    }
  }

  // Para cada frase, quando renderGemini: tenta o WAV PERSISTENTE na voz do Gemini
  // (render-1x + cache → não gasta cota se texto+voz não mudaram) e agenda com o
  // audioPath; se falhar (cota/rede), aquela frase cai na voz do sistema. SEMPRE
  // passa o texto como body (fallback do serviço). audioPath vazio = "voz do sistema".
  const expectedKeys = new Set<string>();
  let preparedAny = false;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    let audioPath = '';
    if (renderGemini) {
      try {
        const { uri, key } = await prepareNudgeAudio(it.text, {
          voiceName,
          persist: true,
          namespace: 'insp',
        });
        audioPath = uri;
        expectedKeys.add(key);
        preparedAny = true;
      } catch {
        audioPath = ''; // cota/rede/sem-áudio → esta frase usa a voz do sistema
      }
    }
    try {
      await native.schedule(
        `${INSP_PREFIX}${i}`,
        nextDailyEpoch(it.hour, it.minute),
        audioPath,
        true,
        'Comentora',
        it.text,
      );
    } catch {
      // segue para os próximos
    }
  }

  // Limpa WAVs órfãos (voz/frases mudaram). Só quando geramos via Gemini e ao
  // menos um WAV foi preparado — assim nunca apagamos áudio ainda válido.
  if (renderGemini && preparedAny) {
    try {
      await cleanupNudgeAudio('insp', expectedKeys);
    } catch {
      /* best-effort */
    }
  }
}

/** Próximo epoch (ms) no dia da semana `dow` (0=domingo … 6=sábado) e hora/min. */
function nextWeeklyEpoch(dow: number, hour: number, minute: number): number {
  const now = new Date();
  const d = new Date(now);
  d.setHours(hour, minute, 0, 0);
  let delta = (dow - d.getDay() + 7) % 7;
  if (delta === 0 && d.getTime() <= now.getTime()) delta = 7;
  d.setDate(d.getDate() + delta);
  return d.getTime();
}

/**
 * Sincroniza os alarmes FALADOS dos LEMBRETES (medicamentos/hábitos) com a lista
 * atual — a mesma ideia das inspirações, fechando a intenção original de que TODO
 * aviso possa ser falado. Pré-renderiza a voz (Gemini cacheado, namespace 'med',
 * + fallback voz do sistema) e arma alarmes nativos que tocam com a tela apagada.
 *  - Diário (todos os dias) → alarme nativo `repeatDaily` (sobrevive a reboot).
 *  - Semanal (dias específicos) → um alarme one-shot por dia ativo, re-armado a
 *    cada `scheduleAllMedications` (abrir o app / salvar). Se o app não for aberto
 *    entre duas ocorrências semanais, a 2ª só vem como notificação (com o piado),
 *    sem voz — a versão falada é best-effort por cima da notificação nativa.
 * Gate: `spokenNudgesEnabled` (a chave "Falar em voz alta"). Best-effort.
 */
export async function syncSpokenMedications(
  items: { id: number; text: string; hour: number; minute: number; daysOfWeek: number[] }[],
): Promise<void> {
  if (!native) return;

  // remove os falados de medicamento anteriores
  try {
    for (const id of native.scheduledIds()) {
      if (id.startsWith(MED_SPOKEN_PREFIX)) await native.cancel(id);
    }
  } catch {
    /* ignore */
  }

  let enabled = false;
  let useGemini = false;
  let voiceName = DEFAULT_GEMINI_VOICE;
  try {
    const c = await getUserConfig();
    enabled = !!c.spokenNudgesEnabled && !c.silentMode; // master toggle; silencioso suprime
    useGemini = c.voiceProvider === 'gemini';
    voiceName = c.geminiVoiceName || DEFAULT_GEMINI_VOICE;
  } catch {
    return;
  }
  if (!enabled) return;

  let renderGemini = useGemini;
  if (renderGemini) {
    try {
      renderGemini = !!(await getApiKey());
    } catch {
      renderGemini = false;
    }
  }

  const expectedKeys = new Set<string>();
  let preparedAny = false;

  for (const it of items) {
    const text = (it.text || '').trim();
    if (!text) continue;
    const daily = !it.daysOfWeek || it.daysOfWeek.length >= 7;

    // áudio gerado uma vez por (texto+voz) — serve a todos os dias do lembrete
    let audioPath = '';
    if (renderGemini) {
      try {
        const { uri, key } = await prepareNudgeAudio(text, {
          voiceName,
          persist: true,
          namespace: 'med',
        });
        audioPath = uri;
        expectedKeys.add(key);
        preparedAny = true;
      } catch {
        audioPath = ''; // cota/rede/sem-áudio → voz do sistema
      }
    }

    if (daily) {
      try {
        await native.schedule(
          `${MED_SPOKEN_PREFIX}${it.id}`,
          nextDailyEpoch(it.hour, it.minute),
          audioPath,
          true,
          'Comentora',
          text,
        );
      } catch {
        /* segue */
      }
    } else {
      for (const dow of it.daysOfWeek) {
        try {
          await native.schedule(
            `${MED_SPOKEN_PREFIX}${it.id}_${dow}`,
            nextWeeklyEpoch(dow, it.hour, it.minute),
            audioPath,
            false, // one-shot; re-armado no próximo scheduleAllMedications
            'Comentora',
            text,
          );
        } catch {
          /* segue */
        }
      }
    }
  }

  if (renderGemini && preparedAny) {
    try {
      await cleanupNudgeAudio('med', expectedKeys);
    } catch {
      /* best-effort */
    }
  }
}

/**
 * GANCHO JITAI (só o ÁUDIO; sem motor de regras). Fala AGORA uma mensagem
 * dinâmica: gera o áudio na voz do Gemini na hora (texto efêmero) e agenda um
 * disparo quase-imediato pelo serviço nativo (funciona com a tela apagada). Se o
 * Gemini não estiver disponível (provider/chave/cota/rede), cai na voz do sistema.
 * Use `delaySeconds` curto (o áudio efêmero vive no cache volátil).
 *
 * NB: o "quando/se disparar" (contexto, gatilhos) é trabalho futuro — esta função
 * entrega apenas o "como falar".
 */
export async function speakDynamicNudgeNow(
  text: string,
  opts: { title?: string; delaySeconds?: number } = {},
): Promise<{ ok: boolean; usedGemini: boolean }> {
  const delayMs = Math.max(0, Math.round((opts.delaySeconds ?? 1) * 1000));
  const id = `${PREFIX}jitai_${Date.now()}`;
  return scheduleSpokenOneShot(id, text, Date.now() + delayMs, opts.title);
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
