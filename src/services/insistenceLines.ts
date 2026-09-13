// COBRANÇAS GERADAS, COM MEMÓRIA.
//
// Antes, as insistências de todo hábito eram 10 frases fixas ciclando por k —
// a mesma ordem, todo dia, para todo mundo. É o que fazia a coruja soar
// mecânica e, depois de uma semana, ignorável.
//
// Agora, UMA chamada ao modelo por dia e por hábito (na hora de agendar a
// corrente) pede as N cobranças DESTA pessoa, para HOJE, com contexto: nome,
// sequência, se fez ontem, o que escreveu na última manhã, a entrevista, e —
// o mais importante — quais técnicas de persuasão já funcionaram com ela e
// quais ela ignora. As linhas ficam em cache (nudge_lines); a corrente as usa.
//
// Sem chave, sem rede ou com resposta inválida: cai nas frases fixas, que
// continuam existindo e rotuladas por técnica. O agendamento NUNCA trava por
// causa disto — há um teto de tempo curto.

import { format } from 'date-fns';
import {
  countNudgeDoneDays,
  getLatestCompletedInterview,
  getNudgeLines,
  getTechniqueStats,
  getUserConfig,
  isNudgeDone,
  setNudgeLines,
  type NudgeLine,
  type TechniqueStat,
} from './database';
import { generateText } from './gemini';
import { generateLocal, type LocalChatMessage } from './localModel';
import { FALLBACK_LINES } from './persuasion';
import { summaryToCoachContext } from './interview';
import type { LocalModelId, Nudge } from '../types';

/** Técnicas que o gerador pode usar. O rótulo é o que entra nas estatísticas. */
export const TECHNIQUES = [
  'pergunta-pessoal',
  'compromisso',
  'passo-pequeno',
  'eu-futuro',
  'aversao-perda',
  'identidade',
  'ritmo',
  'alivio',
  'eu-passado',
  'humor',
  'curto-e-seco',
] as const;

export interface LineContext {
  /** Citações do "eu passado" já formatadas (pode ser vazio). */
  pastSelfQuotes?: string;
  /**
   * Sem cache, NÃO espera o modelo: devolve as fixas na hora e gera em segundo
   * plano. Quando a geração termina e é guardada, chama `onGenerated` — o
   * chamador então reagenda, e desta vez acha o cache. O boot do app nunca
   * espera pela rede.
   */
  deferGeneration?: boolean;
  onGenerated?: () => void;
}

/** Gerações em andamento, por (hábito, dia) — evita disparar duas iguais. */
const inFlight = new Set<string>();

const GENERATION_TIMEOUT_MS = 9000;

function todayISO(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

function yesterdayISO(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return format(d, 'yyyy-MM-dd');
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** "funcionam: eu-futuro (43%), identidade (30%) · ignoradas: humor (0%)" */
function rankTechniques(stats: TechniqueStat[]): string {
  const rated = stats
    .filter((s) => s.shown >= 3)
    .map((s) => ({ t: s.technique, rate: s.converted / s.shown, shown: s.shown }))
    .sort((a, b) => b.rate - a.rate);
  if (rated.length === 0) return '';
  const pct = (r: number) => `${Math.round(r * 100)}%`;
  const good = rated.filter((r) => r.rate >= 0.25).slice(0, 3);
  const bad = rated.filter((r) => r.rate < 0.1).slice(-3);
  const parts: string[] = [];
  if (good.length) parts.push(`funcionam com ela: ${good.map((r) => `${r.t} (${pct(r.rate)})`).join(', ')}`);
  if (bad.length) parts.push(`ela ignora: ${bad.map((r) => `${r.t} (${pct(r.rate)})`).join(', ')}`);
  return parts.join(' · ');
}

const SYSTEM_PROMPT = `Você é a Comentora, uma coruja-coach calorosa, direta e nada robótica. Você escreve as COBRANÇAS curtas que aparecem como notificação e são FALADAS em voz alta quando a pessoa ainda não fez um hábito que ela mesma escolheu.

Regras invioláveis:
- Português do Brasil, natural, como uma amiga que se importa. Sem moralismo, sem sermão.
- Cada cobrança tem no máximo 140 caracteres e cabe numa notificação.
- Sem emojis. Sem aspas em volta da cobrança inteira. Sem numeração.
- Cada cobrança usa UMA técnica diferente das outras. Nunca repita a mesma ideia com outras palavras.
- A 1ª cobrança é uma pergunta pessoal, com o nome da pessoa, sobre se ela já fez.
- A 4ª cobrança é uma PERGUNTA curta (muda o registro: em vez de afirmar, pergunta).
- A 5ª cobrança tem no máximo 8 palavras.
- Se houver citações do que a própria pessoa disse, você PODE usar UMA delas, literalmente e entre aspas, numa das cobranças (técnica "eu-passado"). Nunca invente ou parafraseie uma citação.
- Se houver técnicas que funcionam com esta pessoa, prefira-as. Evite as que ela ignora.

Responda SOMENTE com um array JSON, nesta forma exata:
[{"technique":"<uma das técnicas permitidas>","text":"<a cobrança>"}, ...]`;

interface RawLine {
  technique?: unknown;
  text?: unknown;
}

function parseLines(raw: string, count: number): NudgeLine[] | null {
  // Tolera cercas de código e texto antes/depois do array.
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start < 0 || end <= start) return null;
  let arr: unknown;
  try {
    arr = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!Array.isArray(arr)) return null;
  const allowed = new Set<string>(TECHNIQUES);
  const out: NudgeLine[] = [];
  for (const item of arr as RawLine[]) {
    const text = typeof item?.text === 'string' ? item.text.replace(/\s+/g, ' ').trim() : '';
    let technique = typeof item?.technique === 'string' ? item.technique.trim() : '';
    if (!text || text.length > 180) continue;
    if (!allowed.has(technique)) technique = 'compromisso';
    out.push({ k: out.length + 1, technique, text });
    if (out.length >= count) break;
  }
  return out.length >= Math.min(count, 3) ? out : null;
}

async function buildUserPrompt(nudge: Nudge, count: number, ctx: LineContext): Promise<string> {
  const config = await getUserConfig();
  const [doneDays, doneYesterday, interview, stats] = await Promise.all([
    countNudgeDoneDays(nudge.type, 14),
    isNudgeDone(nudge.type, yesterdayISO()),
    getLatestCompletedInterview().catch(() => null),
    getTechniqueStats().catch(() => [] as TechniqueStat[]),
  ]);
  const lines: string[] = [];
  lines.push(`Hábito: "${nudge.title}"${nudge.body ? ` — ${nudge.body}` : ''}.`);
  lines.push(`Nome da pessoa: ${config.name?.trim() || 'amigo(a)'}.`);
  lines.push(`Fez ${doneDays} dos últimos 14 dias. Ontem: ${doneYesterday ? 'fez' : 'NÃO fez'}.`);
  lines.push(`Tom configurado: ${config.tone}.`);
  const ranking = rankTechniques(stats);
  if (ranking) lines.push(`Histórico de persuasão — ${ranking}.`);
  const interviewCtx = summaryToCoachContext(interview?.summary ?? null);
  if (interviewCtx.trim()) lines.push(`O que você sabe da pessoa (entrevista):\n${interviewCtx}`);
  if (ctx.pastSelfQuotes?.trim()) lines.push(`O que a própria pessoa disse em manhãs ruins:\n${ctx.pastSelfQuotes}`);
  lines.push(`Técnicas permitidas: ${TECHNIQUES.join(', ')}.`);
  lines.push(`Gere exatamente ${count} cobranças, na ordem em que serão enviadas (a 1ª logo depois do horário, as seguintes cada vez mais espaçadas ao longo do dia).`);
  return lines.join('\n');
}

async function generateWithModel(userPrompt: string, count: number): Promise<NudgeLine[] | null> {
  const config = await getUserConfig();
  if (config.aiBackend === 'local') {
    if (!config.localModelId || !config.localModelDownloaded) return null;
    const messages: LocalChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ];
    const raw = await withTimeout(
      generateLocal(config.localModelId as LocalModelId, messages, { maxTokens: 700 }),
      GENERATION_TIMEOUT_MS * 2, // o modelo local é mais lento; ainda assim, com teto
    );
    return parseLines(raw, count);
  }
  const raw = await withTimeout(
    generateText(config.geminiModel, SYSTEM_PROMPT, userPrompt, {
      json: true,
      temperature: 0.95,
      maxOutputTokens: 700,
      timeoutMs: GENERATION_TIMEOUT_MS,
    }),
    GENERATION_TIMEOUT_MS + 500,
  );
  return parseLines(raw, count);
}

/** Frases fixas rotuladas, para quando não há modelo — ou ele falha. */
export function fallbackLines(nudge: Nudge, count: number, userName: string | null): NudgeLine[] {
  const out: NudgeLine[] = [];
  for (let k = 1; k <= count; k++) {
    const f = FALLBACK_LINES[(k - 1) % FALLBACK_LINES.length];
    out.push({ k, technique: f.technique, text: f.line(nudge.title, userName) });
  }
  return out;
}

/**
 * As cobranças de HOJE para este hábito: do cache se já geradas; senão gera
 * (com teto de tempo) e guarda; senão, as fixas. Nunca lança.
 */
export async function getDailyInsistenceLines(
  nudge: Nudge,
  count: number,
  ctx: LineContext = {},
): Promise<{ lines: NudgeLine[]; generated: boolean }> {
  const today = todayISO();
  let userName: string | null = null;
  try {
    userName = (await getUserConfig()).name;
  } catch {
    /* segue sem nome */
  }
  if (count <= 0) return { lines: [], generated: false };
  try {
    const cached = await getNudgeLines(nudge.type, today);
    if (cached.length >= count) return { lines: cached.slice(0, count), generated: true };
  } catch {
    /* cache indisponível: tenta gerar mesmo assim */
  }
  if (ctx.deferGeneration) {
    void generateInBackground(nudge, count, ctx, userName, today);
    return { lines: fallbackLines(nudge, count, userName), generated: false };
  }
  try {
    const lines = await generateAndStore(nudge, count, ctx, userName, today);
    if (lines) return { lines, generated: true };
  } catch (err) {
    console.warn(`[insistenceLines] geração falhou para ${nudge.type}:`, err instanceof Error ? err.message : err);
  }
  return { lines: fallbackLines(nudge, count, userName), generated: false };
}

/** Gera, completa com fixas se vier curto, guarda no cache. null se o modelo não respondeu. */
async function generateAndStore(
  nudge: Nudge,
  count: number,
  ctx: LineContext,
  userName: string | null,
  today: string,
): Promise<NudgeLine[] | null> {
  const userPrompt = await buildUserPrompt(nudge, count, ctx);
  const lines = await generateWithModel(userPrompt, count);
  if (!lines || lines.length === 0) return null;
  const fb = fallbackLines(nudge, count, userName);
  while (lines.length < count) lines.push({ ...fb[lines.length], k: lines.length + 1 });
  await setNudgeLines(nudge.type, today, lines).catch(() => {});
  return lines;
}

async function generateInBackground(
  nudge: Nudge,
  count: number,
  ctx: LineContext,
  userName: string | null,
  today: string,
): Promise<void> {
  const key = `${nudge.type}|${today}`;
  if (inFlight.has(key)) return;
  inFlight.add(key);
  try {
    const lines = await generateAndStore(nudge, count, ctx, userName, today);
    if (lines) ctx.onGenerated?.();
  } catch (err) {
    console.warn(`[insistenceLines] geração em segundo plano falhou para ${nudge.type}:`, err instanceof Error ? err.message : err);
  } finally {
    inFlight.delete(key);
  }
}
