import * as Notifications from 'expo-notifications';
import {
  addAudioClipPlays,
  getAudioClip,
  getInspirationCardById,
  getKV,
  getUserConfig,
  listActiveInspirationCards,
  listEnabledAudioDecksWithClips,
  setAudioClipRating,
  setAudioDeckSeqEnd,
  setAudioDeckSeqStart,
  setInspirationCardRating,
  setKV,
} from './database';
import { clipAvailable, clipUri } from './audioDecks';
import { anyQuietAt, loadQuietPeriods } from './quietHours';
import { INSPIRATION_CATEGORY, ensureChannel, ensureNotificationCategories, gatedSchedule } from './notifications';
import { getOwlSpecies } from '../constants/owlSpecies';
import { syncSpokenInspirations } from './spokenNudges';
import { COMENTORA_MESSAGES } from '../constants/inspirationDefaults';
import type { AudioClip, InspirationCard } from '../types';

/**
 * Modo "inspiração": quando ligado, o Askeo dispara um alerta a cada hora
 * cheia dentro de uma janela diurna, com mensagens curtas de otimismo,
 * persistência e inspiração. São lembretes locais DIÁRIOS (um por hora), então
 * funcionam mesmo com o app fechado, e se repetem todo dia até o usuário
 * desligar o modo.
 *
 * Por que uma janela diurna e não 24h: alertas de madrugada brigariam com o
 * propósito do app (ajudar a dormir). A janela vai de INSPIRATION_START_HOUR
 * até INSPIRATION_END_HOUR (inclusive).
 */
const INSPIRATION_START_HOUR = 8;
const INSPIRATION_END_HOUR = 21;

/** data.type das notificações deste modo — usado para cancelar só elas. */
const INSPIRATION_TYPE = 'inspiration';

interface InspirationMessage {
  title: string;
  body: string;
  /** Texto lido em voz alta (sem aspas decorativas). */
  speak: string;
  /** Card de origem (null nas frases padrão de reserva e nos trechos de áudio). */
  cardId: number | null;
  /** Trecho de áudio de origem (baralho de áudio). */
  clipId: number | null;
  /** Arquivo a tocar no lugar da voz sintetizada (trecho de áudio). */
  audioUri: string | null;
  /** Peso no sorteio: card curtido pesa mais. */
  weight: number;
}

/** Quanto um card com 👍 pesa no sorteio, frente a um card sem nota (1). */
const LIKED_WEIGHT = 4;

/**
 * Converte um card da biblioteca em mensagem de notificação. Citação ganha
 * título "✨ Inspiração"; fato histórico, "📜 Aconteceu um dia". O autor entra
 * como assinatura quando ainda não estiver embutido no texto.
 */
function cardToMessage(c: InspirationCard): InspirationMessage {
  const text = c.text.trim();
  const hasAuthorInText =
    !c.author || text.toLowerCase().includes(c.author.trim().toLowerCase());
  const body = c.author && !hasAuthorInText ? `${text}\n— ${c.author}` : text;
  // a fala remove aspas tipográficas das pontas (a voz não "fala" aspas)
  const speak = body.replace(/^[“"']+/, '').replace(/[”"']+$/, '');
  return {
    title: c.type === 'fact' ? '📜 Aconteceu um dia' : '✨ Inspiração',
    body,
    speak,
    cardId: c.id,
    clipId: null,
    audioUri: null,
    weight: c.rating > 0 ? LIKED_WEIGHT : 1,
  };
}

/** Trecho de áudio → mensagem. A voz é o próprio arquivo: nada de síntese. */
function clipToMessage(c: AudioClip, deckName: string): InspirationMessage {
  const text = (c.text ?? '').trim();
  const body = text
    ? c.author && !text.toLowerCase().includes(c.author.toLowerCase())
      ? `${text}\n— ${c.author}`
      : text
    : `${c.title}${c.author ? `\n— ${c.author}` : ''}`;
  return {
    title: `🎧 ${deckName}`,
    body,
    speak: text,
    cardId: null,
    clipId: c.id,
    audioUri: clipUri(c.deckId, c.fileName),
    weight: c.rating > 0 ? LIKED_WEIGHT : 1,
  };
}

/**
 * Mensagens padrão do Askeo (fallback se a biblioteca estiver vazia — ex.:
 * todos os packs desligados). Mantém o app sempre com algo a dizer.
 */
const FALLBACK_MESSAGES: InspirationMessage[] = COMENTORA_MESSAGES.map((m) => ({
  title: m.title,
  body: m.body,
  speak: m.body,
  cardId: null,
  clipId: null,
  audioUri: null,
  weight: 1,
}));

/**
 * Embaralhamento ESTÁVEL POR DIA: a mesma semente (a data de hoje) produz a
 * mesma ordem em todas as chamadas do dia.
 *
 * Antes era Math.random(): cada agendamento — e ele roda a cada vez que o app
 * volta para a frente, às vezes em dobro — escolhia frases NOVAS, e a versão
 * falada regenerava ~10 áudios na voz do Gemini por abertura (medido no
 * aparelho em 2026-09-23), gastando a cota de TTS que a leitura também usa e
 * nunca aproveitando o cache por texto. Agora as frases mudam uma vez por dia
 * e os áudios são gerados uma vez só.
 */
function shuffledForToday<T>(arr: T[]): T[] {
  const d = new Date();
  let seed = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  const rand = () => {
    // mulberry32 — pequeno, determinístico, suficiente para embaralhar.
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // mistura final (murmur3) para espalhar bem strings curtas parecidas
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return ((h >>> 0) + 0.5) / 4294967296; // (0, 1)
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Ordem do dia com PESO: sorteio exponencial (menor -ln(u)/peso vence), com u
 * fixo por (dia, card). Mantém o que o embaralhamento por dia já garantia — a
 * mesma ordem em todas as chamadas do dia — e acrescenta duas propriedades:
 *  - card curtido (peso 4) cai entre os escolhidos ~4× mais vezes;
 *  - mudar a nota de UM card só mexe naquele card (os demais mantêm a ordem
 *    relativa), então um 👍/👎 não obriga a gerar de novo a voz de todas as
 *    frases do dia.
 */
function weightedOrderForToday(pool: InspirationMessage[]): InspirationMessage[] {
  const day = dayKey(new Date());
  return pool
    .map((m) => ({ m, k: -Math.log(hash01(`${day}:${m.clipId != null ? `clip${m.clipId}` : m.cardId}`)) / m.weight }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.m);
}

// ——— O QUE DISPAROU (para a Home mostrar o card até o próximo chegar) ———
// Os alertas são gatilhos DIÁRIOS cujo conteúdo é fixado a cada agendamento, e as
// falas nativas rodam com o app fechado: o JS não vê o disparo. Guardamos o que
// ficou armado em cada horário e, a cada reagendamento, o que já disparou hoje.

interface Slot {
  hour: number;
  minute: number;
  cardId: number | null;
  clipId?: number | null;
}
/** Referência única do que um horário toca: card = id positivo, trecho de áudio = -id. */
function slotRef(s: Slot): number | null {
  return s.clipId ? -s.clipId : s.cardId;
}
interface FiredState {
  date: string;
  /** "h:m" → referência (ver slotRef) do que disparou naquele horário hoje. */
  slots: Record<string, number>;
  /** O último disparo (atravessa a virada do dia). */
  last: number | null;
}
const ARMED_KEY = 'inspiration_armed';
const FIRED_KEY = 'inspiration_fired';

async function readJson<T>(key: string): Promise<T | null> {
  try {
    const raw = await getKV(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/** Instante (ms) em que o horário `s` cai no dia de `base` (dayOffset: -1 = ontem). */
function slotTime(base: Date, s: Slot, dayOffset = 0): number {
  const d = new Date(base);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(s.hour, s.minute, 0, 0);
  return d.getTime();
}

interface ArmedState {
  /** Quando os horários foram armados: um horário só "disparou" depois disso. */
  armedAt: number;
  slots: Slot[];
}

const COUNTED_KEY = 'inspiration_plays_counted_until';

/**
 * Conta as EXECUÇÕES dos trechos de áudio que dispararam desde a última contagem:
 * os alarmes falados tocam com o app fechado e o JS não vê, então, a cada
 * reagendamento, somamos os horários (de todos os dias) que já passaram desde a
 * última vez. Só conta se a fala está ligada (sem ela o alerta é só notificação).
 */
async function countClipPlays(armed: ArmedState, now: Date): Promise<void> {
  const nowMs = now.getTime();
  const rawCounted = Number(await getKV(COUNTED_KEY)) || 0;
  const from = Math.max(armed.armedAt ?? 0, rawCounted);
  await setKV(COUNTED_KEY, String(nowMs));
  const clipSlots = armed.slots.filter((s) => s.clipId);
  if (!clipSlots.length || from <= 0 || nowMs - from > 30 * 86_400_000) return;
  try {
    const c = await getUserConfig();
    if (!c.spokenNudgesEnabled || c.silentMode || !c.inspirationModeEnabled) return;
    // Com "só com fone" não dá para saber, daqui, se havia fone na hora: não conta.
    if (c.spokenHeadphonesOnly || (c.nudgeVolume ?? 1) <= 0) return;
  } catch {
    return;
  }
  // Horário silencioso: o alerta chegou só como notificação, sem tocar o áudio.
  const quiet = await loadQuietPeriods().catch(() => []);
  const tally = new Map<number, { n: number; last: number }>();
  const day = new Date(from);
  day.setHours(0, 0, 0, 0);
  for (; day.getTime() <= nowMs; day.setDate(day.getDate() + 1)) {
    for (const s of clipSlots) {
      const t = slotTime(day, s);
      if (t > from && t <= nowMs && !anyQuietAt(quiet, s.hour * 60 + s.minute, day.getDay())) {
        const cur = tally.get(s.clipId!) ?? { n: 0, last: 0 };
        cur.n++;
        cur.last = Math.max(cur.last, t);
        tally.set(s.clipId!, cur);
      }
    }
  }
  // Execuções e, para a SEQUÊNCIA, o último trecho que de fato tocou em cada baralho:
  // o dia seguinte continua depois dele, mesmo que o app não tenha sido aberto antes.
  const lastByDeck = new Map<number, { ord: number; at: number }>();
  for (const [id, v] of tally) {
    await addAudioClipPlays(id, v.n, new Date(v.last)).catch(() => {});
    const clip = await getAudioClip(id).catch(() => null);
    if (!clip) continue;
    const cur = lastByDeck.get(clip.deckId);
    if (!cur || v.last > cur.at) lastByDeck.set(clip.deckId, { ord: clip.ord, at: v.last });
  }
  for (const [deckId, v] of lastByDeck) await setAudioDeckSeqEnd(deckId, v.ord).catch(() => {});
}

/** Antes de reagendar: registra o que, do armado anterior, já disparou hoje. */
async function recordFired(now: Date): Promise<void> {
  const armed = await readJson<ArmedState>(ARMED_KEY);
  if (!armed?.slots?.length) return;
  await countClipPlays(armed, now).catch(() => {});
  const armedAt = armed.armedAt ?? 0;
  const today = dayKey(now);
  const prev = await readJson<FiredState>(FIRED_KEY);
  let fired: FiredState;
  if (prev && prev.date === today) {
    fired = prev;
  } else {
    // Virou o dia: o "último disparado" é o horário mais tarde que já tinha
    // disparado ONTEM (os alertas são diários e tocam com o app fechado).
    let last = prev?.last ?? null;
    let latest = -1;
    for (const s of armed.slots) {
      const m = s.hour * 60 + s.minute;
      const ref = slotRef(s);
      if (ref != null && armedAt <= slotTime(now, s, -1) && m > latest) {
        latest = m;
        last = ref;
      }
    }
    fired = { date: today, slots: {}, last };
  }
  const nowMs = now.getTime();
  for (const s of armed.slots) {
    const key = `${s.hour}:${s.minute}`;
    const t = slotTime(now, s);
    const ref = slotRef(s);
    // só disparou hoje se já era hora E já estava armado antes dessa hora
    if (t <= nowMs && armedAt <= t && ref != null && !(key in fired.slots)) {
      fired.slots[key] = ref;
    }
  }
  let latest = -1;
  for (const [key, id] of Object.entries(fired.slots)) {
    const [h, m] = key.split(':').map(Number);
    if (h * 60 + m > latest) {
      latest = h * 60 + m;
      fired.last = id;
    }
  }
  await setKV(FIRED_KEY, JSON.stringify(fired));
}

/** O que a Home mostra: um card de texto ou um trecho de áudio. */
export type CurrentInspiration =
  | { kind: 'card'; card: InspirationCard }
  | { kind: 'clip'; clip: AudioClip; deckName: string };

/**
 * O ÚLTIMO alerta de inspiração disparado (falado ou só notificação), ou null se o
 * modo está desligado / nada foi agendado ainda. É o que a Home mantém visível até
 * o próximo chegar, para a pessoa avaliar.
 */
export async function getCurrentInspiration(now = new Date()): Promise<CurrentInspiration | null> {
  const armed = await readJson<ArmedState>(ARMED_KEY);
  if (!armed?.slots?.length) return null;
  const armedAt = armed.armedAt ?? 0;
  const today = dayKey(now);
  const fired = await readJson<FiredState>(FIRED_KEY);
  const firedToday = fired && fired.date === today ? fired.slots : {};
  const nowMs = now.getTime();
  let best: { m: number; ref: number } | null = null;
  for (const s of armed.slots) {
    const t = slotTime(now, s);
    const key = `${s.hour}:${s.minute}`;
    const recorded = firedToday[key];
    // Disparou hoje se já era hora e já estava armado antes dessa hora (ou está
    // registrado). Ligar o modo às 15h não faz os horários das 8h–14h valerem.
    const ref = recorded ?? (armedAt <= t ? slotRef(s) : null);
    if (ref == null || t > nowMs) continue;
    if (!best || t > best.m) best = { m: t, ref };
  }
  // Antes do 1º alerta de hoje: vale o último de ontem. O registro só é
  // atualizado ao reagendar, então também olhamos o armado: o horário mais
  // tarde que já estava armado antes do seu horário de ontem.
  let yesterday: { m: number; ref: number } | null = null;
  for (const s of armed.slots) {
    const t = slotTime(now, s, -1);
    const ref = slotRef(s);
    if (ref != null && armedAt <= t && (!yesterday || t > yesterday.m)) yesterday = { m: t, ref };
  }
  const ref = best?.ref ?? yesterday?.ref ?? fired?.last ?? null;
  if (ref == null) return null;
  if (ref < 0) {
    const clip = await getAudioClip(-ref);
    if (!clip) return null;
    const deck = (await listEnabledAudioDecksWithClips()).find((d) => d.id === clip.deckId);
    return { kind: 'clip', clip, deckName: deck?.name ?? 'Baralho de áudio' };
  }
  const card = await getInspirationCardById(ref);
  return card ? { kind: 'card', card } : null;
}

/** Nota de um trecho de áudio (1 gostei, -1 eliminar, 0 limpar) e reagenda. */
export async function rateAudioClip(clipId: number, rating: -1 | 0 | 1): Promise<void> {
  await setAudioClipRating(clipId, rating);
  void scheduleInspirationNotifications().catch(() => {});
}

/**
 * Dá nota a um card (1 gostei, -1 não quero mais, 0 limpa) e reagenda: o que
 * recebe 👍 passa a ser sorteado mais vezes; o que recebe 👎 sai dos alertas
 * (inclusive dos já agendados para hoje).
 */
export async function rateInspirationCard(cardId: number, rating: -1 | 0 | 1): Promise<void> {
  await setInspirationCardRating(cardId, rating);
  void scheduleInspirationNotifications().catch(() => {});
}

/** Cancela apenas as notificações do modo inspiração. */
export async function cancelInspirationNotifications(): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  for (const s of scheduled) {
    const data = s.content.data as { type?: string };
    if (data?.type === INSPIRATION_TYPE) {
      await Notifications.cancelScheduledNotificationAsync(s.identifier);
    }
  }
}

/**
 * Reagenda o modo inspiração. Se o modo estiver desligado, apenas cancela.
 * Se ligado, agenda um alerta DIÁRIO em cada hora cheia da janela diurna,
 * cada um com uma mensagem distinta (embaralhada). Idempotente — seguro
 * chamar a cada save / ao abrir o app.
 */
let schedRunning: Promise<void> | null = null;
let schedPending = false;

/**
 * Serializa o reagendamento: 👍/👎 em sequência, a abertura do app e as telas de
 * configuração chamam isto ao mesmo tempo, e duas execuções entrelaçadas
 * deixavam alertas DIÁRIOS duplicados. Uma roda; as demais viram UMA pendente.
 */
export function scheduleInspirationNotifications(): Promise<void> {
  if (schedRunning) {
    schedPending = true;
    return schedRunning;
  }
  schedRunning = (async () => {
    try {
      do {
        schedPending = false;
        await scheduleInspirationNotificationsOnce();
      } while (schedPending);
    } finally {
      schedRunning = null;
    }
  })();
  return schedRunning;
}

async function scheduleInspirationNotificationsOnce(): Promise<void> {
  // O que já disparou hoje (do armado anterior) precisa ser guardado ANTES de
  // reatribuir os cards dos horários.
  await recordFired(new Date()).catch(() => {});
  await cancelInspirationNotifications();

  let enabled = false;
  let sound: string = 'default';
  let perDay = 6;
  try {
    const config = await getUserConfig();
    enabled = !!config.inspirationModeEnabled;
    sound = getOwlSpecies(config.owlSpecies).soundFile ?? 'default';
    perDay = config.inspirationPerDay ?? 6;
  } catch {
    /* sem config legível → trata como desligado */
  }
  if (!enabled) {
    // limpa também os alarmes FALADOS de inspiração (se houver)
    void syncSpokenInspirations([]).catch(() => {});
    await setKV(ARMED_KEY, JSON.stringify({ armedAt: Date.now(), slots: [] })).catch(() => {});
    return;
  }

  const channelId = await ensureChannel();
  await ensureNotificationCategories();

  // FONTES dos alertas: cada baralho de ÁUDIO ligado (toca o arquivo — sem gastar a
  // API) e o conjunto das frases de texto. Com baralho de áudio ligado, as frases de
  // texto só entram se a pessoa pedir para misturar. Os horários são divididos
  // entre as fontes, uma por vez.
  const today = dayKey(new Date());
  const decks = (await listEnabledAudioDecksWithClips().catch(() => [])).map((d) => ({
    ...d,
    clips: d.clips.filter((c) => clipAvailable(c)), // o backup do app não traz os áudios
  })).filter((d) => d.clips.length > 0);
  const mixText = (await getKV('inspiration_mix_text').catch(() => null)) === '1';

  let textPool: InspirationMessage[] | null = null;
  if (decks.length === 0 || mixText) {
    try {
      const cards = await listActiveInspirationCards();
      textPool = cards.length ? cards.map(cardToMessage) : FALLBACK_MESSAGES;
    } catch {
      textPool = FALLBACK_MESSAGES;
    }
  }

  // Espalha `perDay` mensagens na janela diurna [START, END]. Antes era uma
  // por hora fixa; agora o usuário escolhe quantas quer.
  const n = Math.max(1, Math.min(14, Math.round(perDay)));
  const sourceCount = decks.length + (textPool ? 1 : 0);
  // Horário i → fonte (i + rot) % S. `rot` muda a cada dia: com mais fontes do que
  // horários (ex.: 3 baralhos e 2 alertas por dia), todas têm a sua vez.
  const rot = Math.floor(Date.now() / 86_400_000) % sourceCount;
  const sourceOf = (i: number) => (i + rot) % sourceCount;
  const counts = new Array<number>(sourceCount).fill(0);
  for (let i = 0; i < n; i++) counts[sourceOf(i)]++;
  const perSource: InspirationMessage[][] = [];
  for (let k = 0; k < decks.length; k++) {
    const d = decks[k];
    const count = counts[k];
    if (count <= 0) {
      perSource.push([]); // sem horário hoje: o cursor da sequência não anda
      continue;
    }
    if (d.playMode === 'sequence') {
      // NA SEQUÊNCIA: continua de onde o último dia parou; o ponto de partida é
      // fixo durante o dia (reagendar não reembaralha) e avança na virada.
      let startOrd = d.seqStartOrd;
      if (d.seqDate !== today) {
        const after = d.clips.find((c) => c.ord > d.seqEndOrd);
        startOrd = (after ?? d.clips[0]).ord;
      }
      let i0 = d.clips.findIndex((c) => c.ord >= startOrd);
      if (i0 < 0) i0 = 0;
      const list: InspirationMessage[] = [];
      for (let j = 0; j < count; j++) {
        list.push(clipToMessage(d.clips[(i0 + j) % d.clips.length], d.name));
      }
      // Só o ponto de partida do dia; o "último que tocou" é registrado quando o
      // alerta dispara (countClipPlays).
      await setAudioDeckSeqStart(d.id, today, d.clips[i0].ord).catch(() => {});
      perSource.push(list);
    } else {
      perSource.push(weightedOrderForToday(d.clips.map((c) => clipToMessage(c, d.name))));
    }
  }
  if (textPool) {
    perSource.push(textPool === FALLBACK_MESSAGES ? shuffledForToday(textPool) : weightedOrderForToday(textPool));
  }
  const used = perSource.map(() => 0);
  const messages: InspirationMessage[] = [];
  for (let i = 0; i < n; i++) {
    const si = sourceOf(i);
    const list = perSource[si];
    messages.push(list[used[si]++ % list.length]);
  }

  const armedSlots: Slot[] = [];
  // coletados para, ao final, agendar as versões FALADAS (se o recurso estiver on)
  const spokenItems: { text: string; hour: number; minute: number; audioPath?: string }[] = [];
  const startMin = INSPIRATION_START_HOUR * 60;
  const endMin = INSPIRATION_END_HOUR * 60;
  const span = endMin - startMin;

  for (let i = 0; i < n; i++) {
    const t =
      n === 1 ? Math.round(startMin + span / 2) : Math.round(startMin + (span * i) / (n - 1));
    const hour = Math.floor(t / 60);
    const minute = t % 60;
    const msg = messages[i];
    // a versão falada lê o texto limpo (sem aspas; o título é decorativo); o trecho
    // de áudio toca o próprio arquivo
    spokenItems.push({ text: msg.speak, hour, minute, ...(msg.audioUri ? { audioPath: msg.audioUri } : {}) });
    armedSlots.push({ hour, minute, cardId: msg.cardId, clipId: msg.clipId });
    try {
      await gatedSchedule({
        content: {
          title: msg.title,
          body: msg.body,
          data: { type: INSPIRATION_TYPE, hour, cardId: msg.cardId, clipId: msg.clipId },
          sound,
          ...(msg.cardId != null || msg.clipId != null ? { categoryIdentifier: INSPIRATION_CATEGORY } : {}),
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DAILY,
          hour,
          minute,
          channelId,
        },
      });
    } catch (err) {
      console.warn(`failed to schedule inspiration alert @${hour}:${minute}:`, err);
    }
  }

  await setKV(ARMED_KEY, JSON.stringify({ armedAt: Date.now(), slots: armedSlots })).catch(() => {});

  // Agenda as versões FALADAS em background (pré-renderiza a voz Gemini e arma
  // os alarmes nativos). Best-effort e fora do caminho crítico do agendamento.
  void syncSpokenInspirations(spokenItems).catch(() => {});
}
