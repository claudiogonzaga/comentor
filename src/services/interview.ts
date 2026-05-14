// Conduz uma entrevista estruturada-mas-dinâmica com o usuário pra entender
// as causas reais da sua dificuldade de dormir no horário. O modelo (Gemini
// ou local) faz perguntas de aprofundamento baseadas nas respostas e, ao
// final, gera uma sumarização JSON com:
//   - causes: causas raiz identificadas (ex: "ansiedade noturna", "scroll")
//   - triggers: gatilhos comportamentais (ex: "celular na mão antes de dormir")
//   - notes: contexto qualitativo livre pra usar nas mensagens de coach
//   - derivedReasons: 4-6 frases curtas pra usar como botões no SnoozeFeedback
//
// O sumário é persistido e injetado nos prompts do coach e do snooze.

import type {
  ChatMessage,
  GeminiModel,
  InterviewSummary,
  LocalModelId,
  UserConfig,
} from '../types';
import { continueConversation as continueConversationRemote } from './gemini';
import { generateLocal, type LocalChatMessage } from './localModel';
import { getApiKey } from './secureStore';

const INTERVIEW_SYSTEM_PROMPT = `Você é o CoMentor conduzindo uma entrevista breve, calorosa e investigativa para entender por que esta pessoa específica tem dificuldade em deitar no horário que ela mesma escolheu.

Regras:
- Faça UMA pergunta por mensagem. Curta. Conversacional.
- Comece pela pergunta-âncora: "Antes da gente começar, quero entender você. Por que você acha que tem dificuldade pra deitar no horário que escolheu?"
- A partir da resposta, aprofunde com perguntas específicas (ex: "isso acontece todo dia ou em dias específicos?", "o que você normalmente está fazendo quando o horário chega?", "tem algo na cama em si que te incomoda — silêncio, pensamento, ansiedade?").
- Após 4-6 trocas, ou quando perceber que já tem material suficiente, encerre dizendo algo como: "Acho que já entendi o suficiente. Tem mais algo importante que você quer me contar antes da gente continuar?" — e espere a resposta.
- Se a pessoa disser que falou tudo (ou algo equivalente), encerre com uma mensagem curta de agradecimento e termine com EXATAMENTE a marca: <ENTREVISTA_CONCLUIDA>
- Tom: caloroso, sem julgamento, sem dar conselhos durante a entrevista — só investigue.
- Português do Brasil, informal mas respeitoso.`;

const SUMMARY_PROMPT = `Com base na conversa abaixo (entrevista com a pessoa sobre dificuldade de dormir), gere um JSON com este formato exato:

{
  "causes": ["causa raiz 1", "causa raiz 2"],
  "triggers": ["gatilho comportamental 1", "gatilho 2"],
  "notes": "1-2 frases livres com nuances importantes da pessoa",
  "derivedReasons": ["motivo curto 1", "motivo curto 2", "motivo curto 3", "motivo curto 4"]
}

REGRAS:
- causes: 1-3 causas raiz (psicológicas/comportamentais, ex: "ansiedade noturna", "FOMO de mídia social", "trabalho atrasado", "rotina caótica")
- triggers: 1-3 gatilhos concretos (ex: "celular na mão", "TV ligada", "cafeína à noite")
- notes: 1-2 frases qualitativas que ajudem a coach a personalizar mensagens
- derivedReasons: EXATAMENTE 4-6 frases CURTAS (máx 4 palavras cada), no formato de motivo de adiamento ("estou no celular", "ansiedade", "trabalho", "não consigo desligar"). Devem cobrir as causas/triggers identificados. Pra usar como botões em UI.
- Nada além do JSON. Sem texto antes ou depois. Sem markdown.`;

const INTERVIEW_END_MARKER = '<ENTREVISTA_CONCLUIDA>';

export function isInterviewEndSignal(text: string): boolean {
  return text.includes(INTERVIEW_END_MARKER);
}

export function stripEndMarker(text: string): string {
  return text.replace(INTERVIEW_END_MARKER, '').trim();
}

interface BackendOptions {
  aiBackend: UserConfig['aiBackend'];
  geminiModel: GeminiModel;
  localModelId: LocalModelId | null;
  localModelDownloaded: boolean;
}

function shouldUseLocal(opts: BackendOptions): boolean {
  return opts.aiBackend === 'local' && !!opts.localModelId && opts.localModelDownloaded;
}

export async function backendIsAvailable(opts: BackendOptions): Promise<boolean> {
  if (shouldUseLocal(opts)) return true;
  const key = await getApiKey();
  return !!key;
}

interface InterviewExchange {
  role: 'user' | 'corujinha';
  content: string;
}

export async function generateInterviewQuestion(
  opts: BackendOptions,
  history: InterviewExchange[],
  userText: string | null,
): Promise<string> {
  if (shouldUseLocal(opts)) {
    const messages: LocalChatMessage[] = [
      { role: 'system', content: INTERVIEW_SYSTEM_PROMPT },
      ...history.map((m) => ({
        role: (m.role === 'corujinha' ? 'assistant' : 'user') as 'assistant' | 'user',
        content: m.content,
      })),
    ];
    if (userText) {
      messages.push({ role: 'user', content: userText });
    } else if (history.length === 0) {
      messages.push({ role: 'user', content: '[início da entrevista — faça a pergunta-âncora]' });
    }
    return generateLocal(opts.localModelId as LocalModelId, messages, { maxTokens: 250 });
  }

  // Remote (Gemini): usa continueConversationRemote com prompt customizado
  const fakeContext = {
    userName: null,
    bedtime: '00:00',
    currentTime: '00:00',
    minutesLate: 0,
    level: 1 as const,
    streak: 0,
    tone: 'gentle' as const,
    recentLogsSummary: 'entrevista inicial',
    systemPrompt: INTERVIEW_SYSTEM_PROMPT,
  };
  const chatHistory: ChatMessage[] = history.map((m, i) => ({
    id: i,
    habitId: 0,
    role: m.role,
    content: m.content,
    intensityLevel: null,
    createdAt: new Date().toISOString(),
  }));
  const result = await continueConversationRemote(
    fakeContext,
    opts.geminiModel,
    chatHistory,
    userText ?? '[início da entrevista — faça a pergunta-âncora]',
  );
  return result.text;
}

function tryParseSummary(raw: string): InterviewSummary | null {
  // Tenta extrair JSON mesmo se vier com markdown ou texto extra.
  const cleaned = raw.replace(/```json|```/g, '').trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    return {
      causes: Array.isArray(parsed.causes) ? parsed.causes.map(String) : [],
      triggers: Array.isArray(parsed.triggers) ? parsed.triggers.map(String) : [],
      notes: typeof parsed.notes === 'string' ? parsed.notes : '',
      derivedReasons: Array.isArray(parsed.derivedReasons)
        ? parsed.derivedReasons.map(String).slice(0, 6)
        : [],
    };
  } catch {
    return null;
  }
}

export async function summarizeInterview(
  opts: BackendOptions,
  history: InterviewExchange[],
): Promise<InterviewSummary> {
  const transcript = history
    .map((m) => `${m.role === 'corujinha' ? 'CoMentor' : 'Pessoa'}: ${m.content}`)
    .join('\n');

  const userPrompt = `${SUMMARY_PROMPT}\n\nCONVERSA:\n${transcript}`;

  let raw = '';
  if (shouldUseLocal(opts)) {
    const messages: LocalChatMessage[] = [
      { role: 'system', content: 'Você é um analista que extrai dados estruturados de conversas. Responda apenas com JSON válido.' },
      { role: 'user', content: userPrompt },
    ];
    raw = await generateLocal(opts.localModelId as LocalModelId, messages, {
      maxTokens: 600,
      temperature: 0.2,
    });
  } else {
    const fakeContext = {
      userName: null,
      bedtime: '00:00',
      currentTime: '00:00',
      minutesLate: 0,
      level: 1 as const,
      streak: 0,
      tone: 'gentle' as const,
      recentLogsSummary: '',
      systemPrompt:
        'Você é um analista que extrai dados estruturados de conversas. Responda apenas com JSON válido.',
    };
    const result = await continueConversationRemote(fakeContext, opts.geminiModel, [], userPrompt);
    raw = result.text;
  }

  const parsed = tryParseSummary(raw);
  if (parsed) return parsed;

  // Fallback: sumário vazio mas com motivos genéricos pra UI funcionar
  return {
    causes: [],
    triggers: [],
    notes: 'Não consegui sumarizar a entrevista, mas ela ficou salva no histórico.',
    derivedReasons: ['estou no celular', 'não estou com sono', 'ansiedade', 'trabalho atrasado'],
  };
}

export function summaryToCoachContext(summary: InterviewSummary | null): string {
  if (!summary) return '';
  const parts: string[] = [];
  if (summary.causes.length > 0) parts.push(`Causas conhecidas: ${summary.causes.join(', ')}`);
  if (summary.triggers.length > 0) parts.push(`Gatilhos: ${summary.triggers.join(', ')}`);
  if (summary.notes) parts.push(`Notas: ${summary.notes}`);
  return parts.join('. ');
}
