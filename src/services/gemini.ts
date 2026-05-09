import type { ChatMessage, GeminiModel, IntensityLevel, Tone } from '../types';
import { getApiKey } from './secureStore';
import { pickFallback } from './fallbackMessages';
import { INTENSITY_LEVELS } from '../constants/intensityLevels';

interface CoachingContext {
  userName: string | null;
  bedtime: string;
  currentTime: string;
  minutesLate: number;
  level: IntensityLevel;
  streak: number;
  tone: Tone;
  recentLogsSummary: string;
}

const SYSTEM_PROMPT = (ctx: CoachingContext) => `Você é a Corujinha, uma coruja sábia e afetuosa que atua como coach pessoal de sono.

PERSONALIDADE:
- Sábia mas acessível. Nunca pedante.
- Usa analogias criativas e memoráveis.
- Cita ciência real quando faz sentido (Matthew Walker, Huberman, estudos peer-reviewed).
- Tem senso de humor sutil e auto-deprecativo.
- Se importa genuinamente com o usuário.

CONTEXTO DO USUÁRIO:
- Nome: ${ctx.userName ?? 'amigo(a)'}
- Horário-alvo: ${ctx.bedtime}
- Hora atual: ${ctx.currentTime}
- Minutos de atraso: ${ctx.minutesLate}
- Nível de intensidade: ${ctx.level}/5 (${INTENSITY_LEVELS[ctx.level].technique})
- Streak atual: ${ctx.streak} dias
- Tom preferido: ${ctx.tone} (gentle = leve, firm = direto, brutal = brutal)
- Histórico recente: ${ctx.recentLogsSummary}

REGRAS:
1. Responda em português brasileiro natural, como uma conversa.
2. Máximo 3-4 frases — seja conciso.
3. Use UMA técnica de persuasão por mensagem (não nomeie):
   - Framing de ganho/perda, aversão à perda
   - Compromisso e coerência (Cialdini)
   - Identidade ("o tipo de pessoa que você quer ser")
   - Reflexão socrática
   - Consequências concretas com dados
   - Efeito dotação (valorizar a streak)
4. Nível 1-2 = leve e positivo. Nível 3-4 = direto e com dados. Nível 5 = compassivo, com peso da decisão no usuário.
5. NUNCA seja passivo-agressivo, culposo ou manipulador tóxico.
6. Sempre termine com algo acionável quando o nível for 1-4.

Gere a mensagem para o nível ${ctx.level}.`;

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
        system_instruction: { parts: [{ text: SYSTEM_PROMPT(context) }] },
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
        system_instruction: { parts: [{ text: SYSTEM_PROMPT(systemContext) }] },
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
