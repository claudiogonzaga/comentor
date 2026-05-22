import type { ChatMessage, GeminiModel, IntensityLevel, Tone } from '../types';
import { getApiKey } from './secureStore';
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
}

function buildSystemPrompt(ctx: CoachingContext): string {
  const template = ctx.systemPrompt && ctx.systemPrompt.trim().length > 0
    ? ctx.systemPrompt
    : DEFAULT_SYSTEM_PROMPT;
  return fillTemplate(template, {
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
        // Modelo inexistente / servidor instável → tenta o próximo.
        if (
          res.status === 404 ||
          res.status >= 500 ||
          msg.toLowerCase().includes('not found')
        ) {
          continue;
        }
        // Auth / cota → não adianta trocar de modelo.
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
      // Em erro de rede / abort, tenta o próximo modelo também.
    }
  }
  throw new Error(lastError || 'todas as tentativas falharam');
}

export async function generateCoachMessage(
  context: CoachingContext,
  model: GeminiModel,
  history: ChatMessage[],
): Promise<{ text: string; offline: boolean }> {
  const apiKey = await getApiKey();
  if (!apiKey) {
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
    const { text } = await runGenerate(model, apiKey, {
      system_instruction: { parts: [{ text: buildSystemPrompt(context) }] },
      contents,
      generationConfig: {
        maxOutputTokens: 1200,
        temperature: 0.85,
        topP: 0.95,
        thinkingConfig: MAX_THINKING_CONFIG,
      },
    });
    return { text, offline: false };
  } catch (err) {
    console.warn('Gemini failed, using fallback:', err);
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
  const apiKey = await getApiKey();
  if (!apiKey) {
    return {
      text: 'Estou offline agora. Mas a resposta não muda: seu corpo precisa de sono. A gente conversa direito quando você configurar a chave da API. 🦉',
      offline: true,
    };
  }

  const contents: GeminiContent[] = history.slice(-10).map((m) => ({
    role: m.role === 'corujinha' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
  contents.push({ role: 'user', parts: [{ text: userMessage }] });

  try {
    const { text } = await runGenerate(model, apiKey, {
      system_instruction: { parts: [{ text: buildSystemPrompt(systemContext) }] },
      contents,
      generationConfig: {
        maxOutputTokens: 1200,
        temperature: 0.85,
        thinkingConfig: MAX_THINKING_CONFIG,
      },
    });
    return { text, offline: false };
  } catch (err) {
    console.warn('Gemini chat failed:', err);
    return {
      text: 'Tive um problema pra te responder agora. Mas o que importa: você ainda está acordado. O que vamos fazer sobre isso? 🦉',
      offline: true,
    };
  }
}

export async function generateSnoozeArgument(
  context: CoachingContext,
  model: GeminiModel,
  snoozeMinutes: number,
): Promise<{ text: string; offline: boolean }> {
  const apiKey = await getApiKey();
  const offlineLine = (() => {
    const opts = [
      `Mais ${snoozeMinutes}? A gente sabe como isso termina. Toda noite assim, a manhã cobra. Repensa.`,
      `${snoozeMinutes} minutos é o que sua versão de hoje quer. Mas sua versão de amanhã está te observando.`,
      `Você não está mais ganhando ${snoozeMinutes} minutos — está pagando por eles. Em foco, em humor, em saúde. Volta agora.`,
      `Não vou bloquear. Mas vou avisar: cada adiamento ensina seu cérebro que sua palavra vale pouco. Não vai por esse caminho.`,
    ];
    return opts[Math.floor(Math.random() * opts.length)];
  })();

  if (!apiKey) return { text: offlineLine, offline: true };

  const userMsg = `[Sistema interno: o usuário acabou de pedir mais ${snoozeMinutes} minutos antes de dormir. ` +
    `Está atrasado ${context.minutesLate} minutos. Streak: ${context.streak} dias. Tom: ${context.tone}. ` +
    `Gere UMA resposta curta (2-3 frases, máx 250 caracteres) tentando convencê-lo a NÃO adiar. ` +
    `Use uma técnica de persuasão (aversão à perda, identidade, ou efeito dotação da streak). ` +
    `Não seja moralista. Seja direto e respeitoso.]`;

  try {
    const { text } = await runGenerate(model, apiKey, {
      system_instruction: { parts: [{ text: buildSystemPrompt(context) }] },
      contents: [{ role: 'user', parts: [{ text: userMsg }] }],
      generationConfig: {
        maxOutputTokens: 800,
        temperature: 0.9,
        thinkingConfig: MAX_THINKING_CONFIG,
      },
    });
    return { text, offline: false };
  } catch (err) {
    console.warn('Gemini snooze argument failed:', err);
    return { text: offlineLine, offline: true };
  }
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

/**
 * Diagnóstico do chat. Diferente de testApiKey (que manda só "oi" com
 * 5 tokens de resposta), este faz uma chamada real de conversa para
 * detectar problemas no caminho exato que o chat usa.
 */
export async function testChatGeneration(
  model: GeminiModel,
): Promise<{ ok: boolean; modelUsed?: GeminiModel; error?: string }> {
  const apiKey = await getApiKey();
  if (!apiKey) return { ok: false, error: 'sem chave da API configurada' };
  try {
    const { modelUsed } = await runGenerate(
      model,
      apiKey,
      {
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: 'Diga apenas a palavra "ok", sem nada além disso.',
              },
            ],
          },
        ],
        generationConfig: { maxOutputTokens: 30 },
      },
      15000,
    );
    return { ok: true, modelUsed };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'erro desconhecido' };
  }
}
