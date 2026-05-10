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

// Maximum thinking budget (tokens) allowed by current Gemini flash/flash-lite
// generations. This is the upper bound documented for 2.5 flash family; if a
// future generation accepts a higher value we'll bump this. Setting it
// guarantees the model thinks at MAX (never the default of 0 = no thinking
// for flash-lite) on every coaching call.
const MAX_THINKING_BUDGET = 24576;

const MAX_THINKING_CONFIG = {
  thinkingBudget: MAX_THINKING_BUDGET,
  includeThoughts: false,
};

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  error?: { message?: string };
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

  try {
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

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: buildSystemPrompt(context) }] },
        contents,
        generationConfig: {
          maxOutputTokens: 400,
          temperature: 0.85,
          topP: 0.95,
          thinkingConfig: MAX_THINKING_CONFIG,
        },
      }),
    });

    if (!res.ok) {
      throw new Error(`Gemini ${res.status}`);
    }
    const json = (await res.json()) as GeminiResponse;
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) throw new Error('Empty response');
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

  try {
    const contents: GeminiContent[] = history.slice(-10).map((m) => ({
      role: m.role === 'corujinha' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));
    contents.push({ role: 'user', parts: [{ text: userMessage }] });

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: buildSystemPrompt(systemContext) }] },
        contents,
        generationConfig: {
          maxOutputTokens: 400,
          temperature: 0.85,
          thinkingConfig: MAX_THINKING_CONFIG,
        },
      }),
    });

    if (!res.ok) throw new Error(`Gemini ${res.status}`);
    const json = (await res.json()) as GeminiResponse;
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) throw new Error('Empty response');
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

  if (!apiKey) {
    return { text: offlineLine, offline: true };
  }

  try {
    const userMsg = `[Sistema interno: o usuário acabou de pedir mais ${snoozeMinutes} minutos antes de dormir. ` +
      `Está atrasado ${context.minutesLate} minutos. Streak: ${context.streak} dias. Tom: ${context.tone}. ` +
      `Gere UMA resposta curta (2-3 frases, máx 250 caracteres) tentando convencê-lo a NÃO adiar. ` +
      `Use uma técnica de persuasão (aversão à perda, identidade, ou efeito dotação da streak). ` +
      `Não seja moralista. Seja direto e respeitoso.]`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: buildSystemPrompt(context) }] },
        contents: [{ role: 'user', parts: [{ text: userMsg }] }],
        generationConfig: {
          maxOutputTokens: 300,
          temperature: 0.9,
          thinkingConfig: MAX_THINKING_CONFIG,
        },
      }),
    });
    if (!res.ok) throw new Error(`Gemini ${res.status}`);
    const json = (await res.json()) as GeminiResponse;
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) throw new Error('Empty response');
    return { text, offline: false };
  } catch (err) {
    console.warn('Gemini snooze argument failed:', err);
    return { text: offlineLine, offline: true };
  }
}

export async function testApiKey(
  apiKey: string,
  model: GeminiModel = 'gemini-3.1-flash-lite',
): Promise<{ ok: boolean; error?: string; modelTested?: GeminiModel }> {
  const trimmed = apiKey.trim();
  if (!trimmed) return { ok: false, error: 'chave vazia' };
  // If the requested model 404s ("model not found"), fall back through known
  // generations so we still validate the key. We surface which model worked.
  const fallbacks: GeminiModel[] = [
    model,
    'gemini-2.5-flash-lite',
    'gemini-2.0-flash-lite',
  ];
  let lastError: string | null = null;
  for (const m of fallbacks) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${encodeURIComponent(trimmed)}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'oi' }] }],
          generationConfig: { maxOutputTokens: 5 },
        }),
      });
      if (res.ok) {
        const j = (await res.json()) as GeminiResponse;
        if (!j.candidates?.[0]?.content?.parts?.[0]?.text) {
          lastError = 'resposta vazia do Gemini';
          continue;
        }
        return { ok: true, modelTested: m };
      }
      const j = (await res.json().catch(() => ({}))) as GeminiResponse;
      const msg = j.error?.message ?? `HTTP ${res.status}`;
      lastError = msg;
      // Only fall through on 404 / model-not-found; auth errors should fail fast.
      if (res.status === 401 || res.status === 403) {
        return { ok: false, error: msg };
      }
      if (res.status !== 404 && !msg.toLowerCase().includes('not found')) {
        return { ok: false, error: msg };
      }
    } catch (e) {
      lastError = e instanceof Error ? e.message : 'erro de rede';
    }
  }
  return { ok: false, error: lastError ?? 'erro desconhecido' };
}
