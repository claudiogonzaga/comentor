// A COMENTORA COMO COACH DE HÁBITOS: duas ajudas pontuais, nunca no caminho.
//
//  1. Na criação — "Me ajude a formular": a partir do título, sugere 3 pistas, a
//     versão mínima e o plano B. É o pedaço que quase ninguém escreve sozinho e
//     o que mais pesa: plano se-então (Gollwitzer & Sheeran, 2006), versão mínima
//     para os dias ruins, plano de enfrentamento para o obstáculo provável.
//  2. Na revisão de domingo — lê os números da semana e os motivos das faltas e
//     sugere AJUSTES NO PLANO (não na pessoa): pista mais concreta, versão mínima
//     menor, plano B para o obstáculo que se repete.
//
// Sem chave, sem rede, resposta inválida: devolve null e a tela segue sem IA. O
// mesmo provedor do resto do app (Claude ou Gemini, escolhido em Cérebro e Voz).
// A revisão da semana fica guardada em KV para reabrir sem gastar outra chamada.

import { format } from 'date-fns';
import { generateText, hasActiveLlm } from './gemini';
import { getKV, getUserConfig, setKV } from './database';
import type { HabitKind, WeekSummary } from '../types/habits';

export interface HabitPlanSuggestion {
  cues: string[];
  minimum: string;
  planB: string;
  why?: string;
}

export type CoachField = 'cue' | 'minimum' | 'planB' | 'scheduleTime' | 'perWeek';

export interface WeeklySuggestion {
  type: string;
  campo: CoachField;
  valor: string;
  motivo: string;
}

export interface WeeklyReviewResult {
  texto: string;
  sugestoes: WeeklySuggestion[];
}

export interface SavedWeeklyReview {
  weekStart: string;
  /** "O que atrapalhou esta semana?" — o que a pessoa escreveu. */
  note: string;
  result: WeeklyReviewResult | null;
  /** ISO de quando foi guardada. */
  at: string;
}

const SUGGEST_TIMEOUT_MS = 30_000;
/** A revisão manda a semana inteira e o Claude raciocina antes de responder. */
const REVIEW_TIMEOUT_MS = 45_000;

/** Há IA disponível? A tela esconde o botão quando não há. */
export async function coachAvailable(): Promise<boolean> {
  try {
    return await hasActiveLlm();
  } catch {
    return false;
  }
}

/** Tolera cercas de código e texto antes/depois do objeto. */
function parseObject(raw: string): Record<string, unknown> | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const v = JSON.parse(raw.slice(start, end + 1));
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

async function ask(system: string, user: string, maxOutputTokens: number, timeoutMs: number): Promise<string | null> {
  try {
    const config = await getUserConfig();
    return await generateText(config.geminiModel, system, user, {
      json: true,
      temperature: 0.7,
      maxOutputTokens,
      timeoutMs,
    });
  } catch (err) {
    console.warn('habitCoach: IA indisponível —', err instanceof Error ? err.message : err);
    return null;
  }
}

// ————————————————— 1. formular o hábito —————————————————

const SUGGEST_SYSTEM = `Você é a Comentora, uma coruja-coach de hábitos, calorosa e prática. Ajuda a pessoa a formular um hábito com o que a ciência da formação de hábitos sustenta:
- PISTA: um momento que JÁ acontece todo dia (acordar, café, escovar os dentes, chegar em casa…), concreto e observável. O plano fica "Quando [pista], eu [ação]".
- VERSÃO MÍNIMA: tão pequena que dá para fazer no pior dia — dois minutos ou menos. Manter a sequência vale mais que a dose cheia.
- PLANO B: "Se [obstáculo provável], eu [alternativa]" — antecipa o que costuma atrapalhar.
- Num hábito de PARAR: as pistas são os momentos em que a vontade costuma aparecer; o plano B é a SUBSTITUIÇÃO (o que fazer no lugar quando a vontade vier); a versão mínima é o menor passo de resistência (ex.: esperar 10 minutos antes de ceder).
- Português do Brasil, frases curtas e naturais. Sem emojis, sem moralismo, sem culpa.

Responda SOMENTE com JSON, nesta forma exata:
{"cues":["…","…","…"],"minimum":"…","planB":"…","why":"…"}
- cues: 3 pistas diferentes entre si, em minúscula, começando com "ao", "depois do/da/de" ou "antes de", até 6 palavras cada.
- minimum: em minúscula, começando por verbo no infinitivo, até 8 palavras.
- planB: num hábito de fazer, "Se …, eu …" (até 18 palavras); num de parar, começando por verbo no infinitivo (o que fazer no lugar).
- why: uma frase curta de identidade ("Sou alguém que…").`;

/**
 * Sugere pistas, versão mínima e plano B para um hábito. null = sem IA ou
 * falhou (a tela simplesmente não mostra sugestão).
 */
export async function suggestHabitPlan(p: {
  title: string;
  kind: HabitKind;
  cue?: string | null;
  context?: string | null;
}): Promise<HabitPlanSuggestion | null> {
  const title = p.title.trim();
  if (!title) return null;
  const user = [
    `Hábito de ${p.kind === 'parar' ? 'PARAR' : 'FAZER'}: "${title}".`,
    p.cue?.trim() ? `A pessoa pensou nesta pista: "${p.cue.trim()}" (pode melhorá-la ou propor outras).` : '',
    p.context?.trim() ? `Contexto que ela deu: ${p.context.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  const raw = await ask(SUGGEST_SYSTEM, user, 500, SUGGEST_TIMEOUT_MS);
  if (!raw) return null;
  const o = parseObject(raw);
  if (!o) return null;
  const cues = Array.isArray(o.cues)
    ? (o.cues as unknown[])
        .map((c) => str(c, 60).replace(/[.!]$/, ''))
        .filter(Boolean)
        .map((c) => c.charAt(0).toLowerCase() + c.slice(1))
        .slice(0, 3)
    : [];
  const minimum = str(o.minimum, 100).replace(/[.!]$/, '');
  const planB = str(o.planB, 180).replace(/[.!]$/, '');
  const why = str(o.why, 140);
  if (cues.length === 0 && !minimum && !planB) return null;
  return { cues, minimum, planB, ...(why ? { why } : {}) };
}

// ————————————————— 2. revisão da semana —————————————————

const REVIEW_SYSTEM = `Você é a Comentora, uma coruja-coach de hábitos. Faz a revisão da semana com a pessoa: curta, calorosa, concreta e SEM CULPA.
Princípios:
- O que forma hábito é repetir no mesmo contexto. Falhar um dia não importa; o que importa é não falhar dois seguidos.
- Quando um hábito falha muito, o problema é o PLANO (pista vaga, versão mínima grande demais, obstáculo sem plano B, horário ruim), não a pessoa.
- Folga é legítima. Autocompaixão aumenta a constância; culpa diminui.
- Num hábito de parar, cada deslize é informação sobre o gatilho; cada vontade superada é uma vitória.
Para cada hábito você recebe: o id, o plano, feitos/esperados na semana, a força no começo e no fim (0–100%), os motivos registrados de faltas e folgas e, nos de parar, deslizes e vontades superadas.

Responda SOMENTE com JSON, nesta forma exata:
{"texto":"…","sugestoes":[{"type":"<id do hábito>","campo":"cue|minimum|planB|scheduleTime|perWeek","valor":"…","motivo":"…"}]}
- texto: 3 a 5 frases em português do Brasil, começando pelo que deu certo; nomeie um padrão, se houver. Sem emojis, sem listas, sem sermão.
- sugestoes: no máximo 3, só para hábitos que precisam de ajuste (feitos abaixo de 70% do esperado, ou motivos que se repetem). Lista vazia se tudo foi bem.
- valor: o texto NOVO do campo — cue em minúscula ("depois do café"); minimum começando por verbo no infinitivo; planB "Se …, eu …" (ou, num hábito de parar, a substituição começando por verbo); scheduleTime "HH:MM"; perWeek um número de 1 a 7.
- motivo: uma frase curta dizendo por que o ajuste ajuda.`;

/** Os status crus dos eventos, em português, para o modelo ler. */
const STATUS_PT: Record<string, string> = {
  rest: 'folga',
  not_done: 'não fez',
  no_answer: 'sem resposta',
  done: 'feito',
  undone: 'desfeito',
};

function describeFreq(h: WeekSummary['habits'][number]['habit']): string {
  if (h.freq === 'semana') return `${h.perWeek ?? '?'}x por semana`;
  if (h.freq === 'dias') {
    const n = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
    return `dias: ${h.daysOfWeek.map((d) => n[d]).join(', ')}`;
  }
  return 'todo dia';
}

/**
 * Lê a semana e devolve um texto curto e até 3 ajustes de plano. null = sem IA
 * ou falhou.
 */
export async function weeklyReview(summary: WeekSummary, note: string): Promise<WeeklyReviewResult | null> {
  if (summary.habits.length === 0) return null;
  const pc = (v: number) => `${Math.round(v * 100)}%`;
  const lines = summary.habits.map((s) => {
    const h = s.habit;
    const reasons = s.reasons
      .slice(0, 6)
      .map((r) => `${STATUS_PT[r.status] ?? r.status}: ${r.reason}`)
      .join('; ');
    return [
      `- id ${h.type} · "${h.title}" (${h.kind === 'parar' ? 'PARAR' : 'fazer'})`,
      `pista: ${h.cue ?? '—'}`,
      `horário ${h.scheduleTime}`,
      `${describeFreq(h)}`,
      h.kind === 'fazer' ? `versão mínima: ${h.minimum ?? '—'}` : '',
      `plano B: ${h.planB ?? '—'}`,
      `feitos ${s.done}/${s.expected}`,
      `força ${pc(s.strengthStart)} → ${pc(s.strengthEnd)}`,
      reasons ? `motivos: ${reasons}` : '',
      h.kind === 'parar' ? `deslizes ${s.slips}, vontades superadas ${s.resisted}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
  });
  const user = [
    `Semana de ${summary.weekStart} a ${summary.weekEnd}.`,
    ...lines,
    note.trim() ? `O que a pessoa disse que atrapalhou: "${note.trim().slice(0, 500)}"` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const raw = await ask(REVIEW_SYSTEM, user, 1200, REVIEW_TIMEOUT_MS);
  if (!raw) return null;
  const o = parseObject(raw);
  if (!o) return null;
  const texto = str(o.texto, 1200);
  if (!texto) return null;
  const types = new Set(summary.habits.map((s) => s.habit.type));
  const allowed = new Set<CoachField>(['cue', 'minimum', 'planB', 'scheduleTime', 'perWeek']);
  const sugestoes: WeeklySuggestion[] = [];
  for (const item of Array.isArray(o.sugestoes) ? (o.sugestoes as Record<string, unknown>[]) : []) {
    const type = str(item?.type, 40);
    const campo = str(item?.campo, 20) as CoachField;
    let valor = str(item?.valor, 180).replace(/[.!]$/, '');
    const motivo = str(item?.motivo, 220);
    if (!types.has(type) || !allowed.has(campo) || !valor) continue;
    if (campo === 'scheduleTime') {
      const m = valor.match(/^(\d{1,2}):(\d{2})$/);
      if (!m || +m[1] > 23 || +m[2] > 59) continue;
      valor = `${m[1].padStart(2, '0')}:${m[2]}`;
    }
    if (campo === 'perWeek') {
      const n = parseInt(valor, 10);
      if (!Number.isFinite(n) || n < 1 || n > 7) continue;
      valor = String(n);
    }
    if (campo === 'cue') valor = valor.charAt(0).toLowerCase() + valor.slice(1);
    sugestoes.push({ type, campo, valor, motivo });
    if (sugestoes.length >= 3) break;
  }
  return { texto, sugestoes };
}

// ————————————————— guardar a revisão —————————————————

const reviewKey = (weekStart: string) => `habitos.revisao.${weekStart}`;
const dismissKey = (weekStart: string) => `habitos.revisao.dispensada.${weekStart}`;

export async function saveWeeklyReview(weekStart: string, note: string, result: WeeklyReviewResult | null): Promise<void> {
  const v: SavedWeeklyReview = { weekStart, note, result, at: new Date().toISOString() };
  await setKV(reviewKey(weekStart), JSON.stringify(v));
}

export async function getWeeklyReview(weekStart: string): Promise<SavedWeeklyReview | null> {
  try {
    const raw = await getKV(reviewKey(weekStart));
    if (!raw) return null;
    const v = JSON.parse(raw) as SavedWeeklyReview;
    return v && v.weekStart === weekStart ? v : null;
  } catch {
    return null;
  }
}

/** "Agora não" no cartão da Home: some até a próxima semana. */
export async function dismissWeeklyReviewCard(weekStart: string): Promise<void> {
  await setKV(dismissKey(weekStart), '1');
}

function ymd(d: Date): string {
  return format(d, 'yyyy-MM-dd');
}

/**
 * A segunda-feira da semana a revisar: no domingo, a semana que está acabando;
 * na segunda, a que acabou ontem; nos outros dias, a semana corrente até aqui.
 */
export function reviewWeekStart(now: Date = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  const dow = d.getDay();
  const back = dow === 0 ? 6 : dow === 1 ? 7 : dow - 1;
  d.setDate(d.getDate() - back);
  return ymd(d);
}

/** Domingo depois das 17h, ou segunda o dia todo: hora da revisão (o efeito "recomeço"). */
export function isWeeklyReviewTime(now: Date = new Date()): boolean {
  const dow = now.getDay();
  return (dow === 0 && now.getHours() >= 17) || dow === 1;
}

/** O cartão da Home aparece? Só na hora certa, se a semana ainda não foi revista nem dispensada. */
export async function shouldShowWeeklyReviewCard(now: Date = new Date()): Promise<boolean> {
  if (!isWeeklyReviewTime(now)) return false;
  const ws = reviewWeekStart(now);
  try {
    if (await getKV(dismissKey(ws))) return false;
    return !(await getWeeklyReview(ws));
  } catch {
    return false;
  }
}
