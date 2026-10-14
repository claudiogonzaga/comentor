import type { ChatMessage, GeminiModel, IntensityLevel, Tone } from '../types';
import { getApiKey } from './secureStore';
import { getUserConfig } from './database';
import { DEFAULT_CLAUDE_EFFORT, DEFAULT_CLAUDE_MODEL, claudeComplete, getClaudeKey } from './claude';
import { pickFallback } from './fallbackMessages';
import { INTENSITY_LEVELS } from '../constants/intensityLevels';
import { DEFAULT_SYSTEM_PROMPT, fillTemplate } from '../constants/promptTemplate';

interface CoachingContext {
  userName: string | null;
  bedtime: string;
  currentTime: string;
  minutesLate: number;
  level: IntensityLevel;
  streak: number;
  tone: Tone;
  recentLogsSummary: string;
  systemPrompt?: string;
  /** Resumo dos dados de saúde (sono/exercício/passos) do Health Connect. */
  healthContext?: string;
}

function buildSystemPrompt(ctx: CoachingContext): string {
  const template = ctx.systemPrompt && ctx.systemPrompt.trim().length > 0
    ? ctx.systemPrompt
    : DEFAULT_SYSTEM_PROMPT;
  const base = fillTemplate(template, {
    userName: ctx.userName ?? 'amigo(a)',
    bedtime: ctx.bedtime,
    currentTime: ctx.currentTime,
    minutesLate: ctx.minutesLate,
    level: ctx.level,
    technique: INTENSITY_LEVELS[ctx.level].technique,
    streak: ctx.streak,
    tone: ctx.tone,
    recentLogsSummary: ctx.recentLogsSummary,
  });
  if (ctx.healthContext && ctx.healthContext.trim().length > 0) {
    return `${base}\n\nDADOS DE SAÚDE RECENTES (do Health Connect — use para personalizar, mas não soe robótico citando números crus):\n${ctx.healthContext}`;
  }
  return base;
}

interface GeminiContent {
  role: 'user' | 'model';
  parts: { text: string }[];
}

const MAX_THINKING_BUDGET = 24576;
const MAX_THINKING_CONFIG = {
  thinkingBudget: MAX_THINKING_BUDGET,
  includeThoughts: false,
};

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  error?: { message?: string };
}

/**
 * Modelos de reserva. Se o modelo configurado pelo usuário não existir
 * mais (404 "not found") ou der erro de servidor, a chamada cai para o
 * próximo. Mantém o app funcionando quando o Google muda nomes de modelo.
 */
const MODEL_FALLBACKS: GeminiModel[] = [
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash-lite',
];

async function postJson(
  url: string,
  body: unknown,
  timeoutMs = 25000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Tenta gerar uma resposta passando pelo modelo preferido e, em caso de
 * 404 / servidor / rede, pelos modelos de reserva. Devolve o texto e o
 * modelo que efetivamente respondeu.
 */
async function runGenerate(
  preferred: GeminiModel,
  apiKey: string,
  body: object,
  timeoutMs = 25000,
): Promise<{ text: string; modelUsed: GeminiModel }> {
  const tried = new Set<GeminiModel>();
  const queue: GeminiModel[] = [preferred, ...MODEL_FALLBACKS];
  let lastError = '';
  for (const m of queue) {
    if (tried.has(m)) continue;
    tried.add(m);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${encodeURIComponent(apiKey)}`;
    try {
      const res = await postJson(url, body, timeoutMs);
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as GeminiResponse;
        const msg = j.error?.message ?? `HTTP ${res.status}`;
        lastError = `${m}: ${msg}`;
        if (
          res.status === 404 ||
          res.status >= 500 ||
          msg.toLowerCase().includes('not found')
        ) {
          continue;
        }
        throw new Error(msg);
      }
      const j = (await res.json()) as GeminiResponse;
      const text = j.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (!text) {
        lastError = `${m}: resposta vazia`;
        continue;
      }
      return { text, modelUsed: m };
    } catch (e) {
      lastError = e instanceof Error ? e.message : 'erro de rede';
    }
  }
  throw new Error(lastError || 'todas as tentativas falharam');
}

// ——— PROVEDOR: Gemini ou Claude (escolhido em Cérebro e Voz) ———
// As funções abaixo montam o pedido uma vez e `run` o envia ao provedor ativo.
// Com "Claude" escolhido mas sem chave da Anthropic, cai no Gemini (se houver chave).

type ActiveLlm = { provider: 'claude'; apiKey: string; model: string; effort: string } | { provider: 'gemini'; apiKey: string };

async function activeLlm(): Promise<ActiveLlm | null> {
  let provider: 'gemini' | 'claude' = 'gemini';
  let claudeModel = DEFAULT_CLAUDE_MODEL;
  let effort: string = DEFAULT_CLAUDE_EFFORT;
  try {
    const c = await getUserConfig();
    provider = c.aiProvider;
    claudeModel = c.claudeModel || DEFAULT_CLAUDE_MODEL;
    effort = c.claudeEffort || DEFAULT_CLAUDE_EFFORT;
  } catch {
    /* sem config legível: Gemini */
  }
  if (provider === 'claude') {
    const k = await getClaudeKey();
    if (k) return { provider: 'claude', apiKey: k, model: claudeModel, effort };
  }
  const g = await getApiKey();
  return g ? { provider: 'gemini', apiKey: g } : null;
}

/** Há um provedor de API pronto para atender (Claude com chave, ou Gemini com chave)? */
export async function hasActiveLlm(): Promise<boolean> {
  return !!(await activeLlm());
}

interface RunParams {
  system?: string;
  contents: GeminiContent[];
  maxOutputTokens: number;
  temperature?: number;
  topP?: number;
  /** Gemini: liga o raciocínio no máximo (o Claude raciocina sempre, de forma adaptativa). */
  thinking?: boolean;
  json?: boolean;
}

async function run(llm: ActiveLlm, geminiModel: GeminiModel, p: RunParams, timeoutMs?: number): Promise<string> {
  if (llm.provider === 'claude') {
    const text = await claudeComplete(llm.apiKey, {
      model: llm.model,
      effort: llm.effort,
      system: p.json
        ? `${p.system ?? ''}\n\nResponda SOMENTE com JSON válido, sem texto antes ou depois e sem cercas de código.`.trim()
        : p.system,
      turns: p.contents.map((c) => ({
        role: c.role === 'model' ? ('assistant' as const) : ('user' as const),
        text: c.parts.map((x) => x.text).join('\n'),
      })),
      maxOutputTokens: p.maxOutputTokens,
      timeoutMs,
    });
    // tira cercas ```json … ``` se vierem mesmo assim
    return p.json ? text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim() : text;
  }
  const { text } = await runGenerate(
    geminiModel,
    llm.apiKey,
    {
      ...(p.system ? { system_instruction: { parts: [{ text: p.system }] } } : {}),
      contents: p.contents,
      generationConfig: {
        maxOutputTokens: p.maxOutputTokens,
        ...(p.temperature != null ? { temperature: p.temperature } : {}),
        ...(p.topP != null ? { topP: p.topP } : {}),
        ...(p.thinking ? { thinkingConfig: MAX_THINKING_CONFIG } : {}),
        ...(p.json ? { responseMimeType: 'application/json' } : {}),
      },
    },
    timeoutMs,
  );
  return text;
}

export async function generateCoachMessage(
  context: CoachingContext,
  model: GeminiModel,
  history: ChatMessage[],
): Promise<{ text: string; offline: boolean }> {
  const llm = await activeLlm();
  if (!llm) {
    return {
      text: pickFallback(context.level, context.tone, {
        bedtime: context.bedtime,
        minutesLate: context.minutesLate,
        streak: context.streak,
      }),
      offline: true,
    };
  }

  const contents: GeminiContent[] = history.slice(-10).map((m) => ({
    role: m.role === 'corujinha' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
  if (contents.length === 0 || contents[contents.length - 1].role !== 'user') {
    contents.push({
      role: 'user',
      parts: [
        {
          text: `[Sistema: gere uma mensagem de coach de sono para nível ${context.level}, ${context.minutesLate} minutos atrasado.]`,
        },
      ],
    });
  }

  try {
    const text = await run(llm, model, {
      system: buildSystemPrompt(context),
      contents,
      maxOutputTokens: 1200,
      temperature: 0.85,
      topP: 0.95,
      thinking: true,
    });
    return { text, offline: false };
  } catch (err) {
    console.warn('IA falhou, usando reserva:', err);
    return {
      text: pickFallback(context.level, context.tone, {
        bedtime: context.bedtime,
        minutesLate: context.minutesLate,
        streak: context.streak,
      }),
      offline: true,
    };
  }
}

export async function continueConversation(
  systemContext: CoachingContext,
  model: GeminiModel,
  history: ChatMessage[],
  userMessage: string,
): Promise<{ text: string; offline: boolean }> {
  const llm = await activeLlm();
  if (!llm) {
    return {
      text: 'Estou offline agora. Mas a resposta não muda: seu corpo precisa de sono. A gente conversa direito quando você configurar a chave da API.',
      offline: true,
    };
  }

  const contents: GeminiContent[] = history.slice(-10).map((m) => ({
    role: m.role === 'corujinha' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
  // Chat e entrevista gravam a fala do usuário antes de chamar: ela já vem no
  // fim do histórico. Reenviá-la faria o modelo receber a resposta duplicada.
  const last = history[history.length - 1];
  if (!(last && last.role === 'user' && last.content.trim() === userMessage.trim())) {
    contents.push({ role: 'user', parts: [{ text: userMessage }] });
  }

  try {
    const text = await run(llm, model, {
      system: buildSystemPrompt(systemContext),
      contents,
      maxOutputTokens: 1200,
      temperature: 0.85,
      thinking: true,
    });
    return { text, offline: false };
  } catch (err) {
    console.warn('IA (chat) falhou:', err);
    return {
      text: 'Tive um problema pra te responder agora. Mas o que importa: você ainda está acordado. O que vamos fazer sobre isso?',
      offline: true,
    };
  }
}

export async function generateSnoozeArgument(
  context: CoachingContext,
  model: GeminiModel,
  snoozeMinutes: number,
): Promise<{ text: string; offline: boolean }> {
  const llm = await activeLlm();
  const offlineLine = (() => {
    const opts = [
      `Mais ${snoozeMinutes}? A gente sabe como isso termina. Toda noite assim, a manhã cobra. Repensa.`,
      `${snoozeMinutes} minutos é o que sua versão de hoje quer. Mas sua versão de amanhã está te observando.`,
      `Você não está mais ganhando ${snoozeMinutes} minutos — está pagando por eles. Em foco, em humor, em saúde. Volta agora.`,
      `Não vou bloquear. Mas vou avisar: cada adiamento ensina seu cérebro que sua palavra vale pouco. Não vai por esse caminho.`,
    ];
    return opts[Math.floor(Math.random() * opts.length)];
  })();

  if (!llm) return { text: offlineLine, offline: true };

  const userMsg = `[Sistema interno: o usuário acabou de pedir mais ${snoozeMinutes} minutos antes de dormir. ` +
    `Está atrasado ${context.minutesLate} minutos. Streak: ${context.streak} dias. Tom: ${context.tone}. ` +
    `Gere UMA resposta curta (2-3 frases, máx 250 caracteres) tentando convencê-lo a NÃO adiar. ` +
    `Use uma técnica de persuasão (aversão à perda, identidade, ou efeito dotação da streak). ` +
    `Não seja moralista. Seja direto e respeitoso.]`;

  try {
    const text = await run(llm, model, {
      system: buildSystemPrompt(context),
      contents: [{ role: 'user', parts: [{ text: userMsg }] }],
      maxOutputTokens: 800,
      temperature: 0.9,
      thinking: true,
    });
    return { text, offline: false };
  } catch (err) {
    console.warn('IA (adiamento) falhou:', err);
    return { text: offlineLine, offline: true };
  }
}

/**
 * Geração genérica, fora do chat: um system prompt + um pedido, sem histórico.
 * Usada para gerar em lote as cobranças do dia. Timeout curto de propósito: a
 * chamada acontece durante o agendamento e não pode segurar o app.
 */
export async function generateText(
  model: GeminiModel,
  systemPrompt: string,
  userPrompt: string,
  opts: { maxOutputTokens?: number; temperature?: number; timeoutMs?: number; json?: boolean } = {},
): Promise<string> {
  const llm = await activeLlm();
  if (!llm) throw new Error('sem chave da API');
  return run(
    llm,
    model,
    {
      system: systemPrompt,
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      maxOutputTokens: opts.maxOutputTokens ?? 900,
      temperature: opts.temperature ?? 0.9,
      json: opts.json,
    },
    opts.timeoutMs ?? 12000,
  );
}

export async function testApiKey(
  apiKey: string,
  model: GeminiModel = 'gemini-2.5-flash-lite',
): Promise<{ ok: boolean; error?: string; modelTested?: GeminiModel }> {
  const trimmed = apiKey.trim();
  if (!trimmed) return { ok: false, error: 'chave vazia' };
  try {
    const { modelUsed } = await runGenerate(
      model,
      trimmed,
      {
        contents: [{ role: 'user', parts: [{ text: 'oi' }] }],
        generationConfig: { maxOutputTokens: 5 },
      },
      15000,
    );
    return { ok: true, modelTested: modelUsed };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'erro desconhecido' };
  }
}
