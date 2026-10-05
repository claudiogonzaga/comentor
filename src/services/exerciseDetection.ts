// TREINO NO RELÓGIO confirma o hábito de exercício.
//
// Se a pessoa gravou um treino no relógio (chega ao Health Connect pelo Huawei
// Health / Health Sync), o Askeo não precisa perguntar "fez o exercício?".
// Regras conservadoras, porque uma confirmação falsa é pior que uma pergunta:
//  - só origens CONFIÁVEIS (as que trazem o relógio), nunca passos do celular;
//  - o tipo de treino precisa bater com o hábito, quando o título diz qual é
//    ("caminhada", "corrida", "musculação"…); título genérico aceita qualquer;
//  - a soma dos treinos de hoje precisa atingir os minutos do título
//    ("Exercício 30 min"), ou 20 min se o título não disser;
//  - confirma UMA vez por dia e hábito: se a pessoa desfizer, fica desfeito.

import { format } from 'date-fns';
import { getDoneNudgeTypes, getKV, listNudges, setKV } from './database';
import { confirmNudge } from './nudges';
import { getExerciseSessions, hasHealthPermissions, originLabel, WATCH_ORIGINS } from './health';

const DEFAULT_MIN_MINUTES = 20;
const CHECK_EVERY_MS = 10 * 60_000;
let lastCheck = 0;
let running = false;

// Tipos do Health Connect (ExerciseSessionRecord.exerciseType).
const T = {
  walking: [79, 37], // caminhada, trilha
  running: [56, 57], // corrida, esteira
  biking: [8, 9],
  strength: [70, 81, 13], // musculação, levantamento de peso, calistenia
  swimming: [73, 74],
};

function norm(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

const EXERCISE_WORDS =
  /exercic|trein|academia|muscula|corrid|correr|caminhad|caminhar|pedal|bicicleta|bike|natacao|nadar|cardio|zona 2|esteira|malhar|atividade fisica/;

// "Exercícios de respiração", "Treinar inglês", "Exercício de gratidão"… não
// são treino físico: um treino no relógio não pode confirmá-los.
const NOT_PHYSICAL =
  /respira|gratid|ingles|idioma|lingua|kegel|fisio|medita|mental|leitura|escrita|piano|violao|musica|vocal|memoria|foco|olho|ocular|postura|alongamento|mindful/;

// Treino "genérico" (título sem esporte): não vale alongamento (71), ioga (83),
// respiração guiada (33) nem pilates (48) — são práticas, não exercício.
const NOT_GENERIC_WORKOUT = [71, 83, 33, 48];

// Complementos que mantêm "exercício de …"/"treino de …" no campo FÍSICO.
const PHYSICAL_COMPLEMENT =
  /^(fisicos?|aerobicos?|cardio|forca|funcional|hiit|alta|resistencia|pernas?|bracos?|abdom|core|peso|musculacao|academia|corrida|caminhada)/;

/** Tipos aceitos pelo hábito (null = qualquer treino) — ou undefined se não é hábito de exercício. */
function acceptedTypes(title: string): number[] | null | undefined {
  const t = norm(title);
  if (!EXERCISE_WORDS.test(t) || NOT_PHYSICAL.test(t)) return undefined;
  if (/caminh/.test(t)) return T.walking;
  if (/corr|esteira/.test(t)) return T.running;
  if (/pedal|bicicleta|bike/.test(t)) return T.biking;
  if (/muscula|academia|malhar|forca/.test(t)) return T.strength;
  if (/natacao|nadar/.test(t)) return T.swimming;
  // Genérico: "Exercício", "Treino 30 min", "Exercício físico". Mas
  // "Exercícios de matemática" / "Treinar redação" não são treino físico —
  // exige que o complemento, se houver, seja físico.
  const comp = t.match(/(?:exercicios?|treinos?|treinar)\s+(?:de\s+|do\s+|da\s+)?([a-z]+)/);
  if (comp && !/^(min|minutos?|h|horas?|diario|diaria|hoje|leve|pesado|rapido|curto|longo)$/.test(comp[1]) && !PHYSICAL_COMPLEMENT.test(comp[1])) {
    return undefined;
  }
  return null;
}

/**
 * Minutos exigidos pelo título ("30 min", "1h", "1h30", "1,5 hora"), senão o
 * padrão. Ignora horários ("às 18h", "7h da manhã" não são duração).
 */
export function requiredMinutes(title: string): number {
  // Tira horários do dia: "às 18h", "as 7h30", "18:30".
  const t = norm(title)
    .replace(/\bas\s+\d{1,2}\s*(?:h(?:\s*\d{1,2})?|:\d{2})/g, ' ')
    .replace(/\b\d{1,2}:\d{2}\b/g, ' ');
  let minutes: number | null = null;
  const hm = t.match(/(\d+)\s*h\s*(\d{1,2})(?!\d)/); // 1h30, 1h 30min
  const h = t.match(/(\d+(?:[.,]\d+)?)\s*(?:h(?![a-z])|horas?)/);
  const m = t.match(/(\d+)\s*(?:min|minutos?)(?![a-z])/);
  if (hm) minutes = parseInt(hm[1], 10) * 60 + parseInt(hm[2], 10);
  else if (h) minutes = Math.round(parseFloat(h[1].replace(',', '.')) * 60);
  else if (m) minutes = parseInt(m[1], 10);
  // Absurdo (> 5 h) ou zero: título ambíguo — usa o padrão.
  if (minutes == null || minutes <= 0 || minutes > 300) return DEFAULT_MIN_MINUTES;
  return minutes;
}

/**
 * Confere os treinos de hoje e confirma os hábitos de exercício cumpridos.
 * Barato de chamar (limitado a uma leitura a cada 10 min; `force` ignora).
 * Nunca lança. Devolve os títulos confirmados agora.
 */
export async function checkExerciseEvidence(force = false): Promise<string[]> {
  if (running) return [];
  if (!force && Date.now() - lastCheck < CHECK_EVERY_MS) return [];
  running = true;
  lastCheck = Date.now();
  try {
    if (!(await hasHealthPermissions())) return [];
    const today = format(new Date(), 'yyyy-MM-dd');
    const nudges = (await listNudges()).filter((n) => n.enabled && acceptedTypes(n.title) !== undefined);
    if (!nudges.length) return [];
    const done = new Set(await getDoneNudgeTypes(today));

    const t0 = new Date();
    t0.setHours(0, 0, 0, 0);
    // Só as origens do relógio, filtradas ANTES de deduplicar.
    const sessions = await getExerciseSessions(t0.toISOString(), new Date().toISOString(), WATCH_ORIGINS);
    if (!sessions.length) return [];

    // Um treino só cumpre UM hábito: sessões usadas saem do pool. Os hábitos
    // são avaliados em ordem de horário (o treino da manhã vai para o da manhã),
    // e cada um consome só o MÍNIMO de treinos que atinge os seus minutos.
    // Treinos já usados por confirmações anteriores de hoje também saem.
    const usedKey = `exercise_used:${today}`;
    const used = new Set<string>(JSON.parse((await getKV(usedKey)) ?? '[]') as string[]);
    let pool = sessions.filter((s) => !used.has(s.start)); // já em ordem de início
    const accepts = (types: number[] | null | undefined, s: (typeof sessions)[number]) =>
      types == null ? !NOT_GENERIC_WORKOUT.includes(s.exerciseType) : types.includes(s.exerciseType);
    /** Treinos (em ordem) até somar `need` minutos; null se não chega. */
    const take = (types: number[] | null | undefined, need: number) => {
      const out: typeof sessions = [];
      let sum = 0;
      for (const s of pool) {
        if (!accepts(types, s)) continue;
        out.push(s);
        sum += s.minutes;
        if (sum >= need) return { list: out, minutes: sum };
      }
      return null;
    };

    const confirmed: string[] = [];
    for (const n of [...nudges].sort((a, b) => a.scheduleTime.localeCompare(b.scheduleTime))) {
      const types = acceptedTypes(n.title);
      const need = requiredMinutes(n.title);
      if (done.has(n.type)) {
        // Marcado à mão: se é de um esporte específico, o treino compatível já
        // "pertence" a ele e não pode confirmar outro hábito.
        if (types != null) {
          const got = take(types, need);
          if (got) pool = pool.filter((s) => !got.list.includes(s));
        }
        continue;
      }
      const ackKey = `exercise_auto:${today}:${n.type}`;
      if (await getKV(ackKey)) continue; // já confirmado hoje (e talvez desfeito)
      const got = take(types, need);
      if (!got) continue;
      const via = originLabel(got.list[0].origin);
      const evidence = `relógio · ${via} · ${Math.round(got.minutes)} min em ${got.list.length} treino(s)`;
      // O hábito aconteceu quando o treino que completou os minutos terminou.
      const occurredAt = new Date(got.list[got.list.length - 1].end).getTime();
      await setKV(ackKey, evidence);
      for (const s of got.list) used.add(s.start);
      await setKV(usedKey, JSON.stringify([...used]));
      pool = pool.filter((s) => !got.list.includes(s));
      await confirmNudge(n.type, { via: 'sensor', evidence, occurredAt });
      confirmed.push(n.title);
    }
    return confirmed;
  } catch (err) {
    console.warn('[exerciseDetection] falhou:', err);
    return [];
  } finally {
    running = false;
  }
}
