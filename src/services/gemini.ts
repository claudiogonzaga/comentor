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
          maxOutputTokens: 300,
          temperature: 0.85,
          topP: 0.95,
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
        generationConfig: { maxOutputTokens: 300, temperature: 0.85 },
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

export async function testApiKey(
  apiKey: string,
  model: GeminiModel = 'gemini-2.0-flash-lite',
): Promise<{ ok: boolean; error?: string }> {
  const trimmed = apiKey.trim();
  if (!trimmed) return { ok: false, error: 'chave vazia' };
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(trimmed)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'oi' }] }],
        generationConfig: { maxOutputTokens: 5 },
      }),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as GeminiResponse;
      const msg = j.error?.message ?? `HTTP ${res.status}`;
      return { ok: false, error: msg };
    }
    const j = (await res.json()) as GeminiResponse;
    if (!j.candidates?.[0]?.content?.parts?.[0]?.text) {
      return { ok: false, error: 'resposta vazia do Gemini' };
    }
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'erro de rede';
    return { ok: false, error: msg };
  }
}
