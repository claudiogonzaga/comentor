// Cliente do CLAUDE (Anthropic) — o "cérebro" alternativo ao Gemini.
//
// HTTP direto em /v1/messages: o SDK oficial (@anthropic-ai/sdk) não suporta
// React Native. Só TEXTO — a voz neural continua sendo a do Gemini TTS (o Claude
// não gera áudio), então a chave do Gemini segue valendo para a voz.
//
// Particularidades dos modelos atuais (Opus 5.5 / Sonnet 5.5 / Haiku 5.5):
//  - o raciocínio (thinking) é adaptativo e está sempre ligado; a profundidade é
//    controlada por output_config.effort, que o usuário escolhe (padrão 'medium');
//  - temperature / top_p / top_k NÃO são aceitos (HTTP 400): não são enviados;
//  - o raciocínio conta dentro de max_tokens, então o teto é folgado;
//  - o modelo pode recusar por segurança (stop_reason "refusal") com HTTP 200.

import * as SecureStore from 'expo-secure-store';

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODELS_URL = 'https://api.anthropic.com/v1/models';
const API_VERSION = '2023-06-01';
/** Recusa por segurança → a API refaz o pedido no modelo de reserva recomendado. */
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export interface ClaudeModelInfo {
  id: string;
  label: string;
  sub: string;
  /** O parâmetro `fallbacks` existe para este modelo? (o Haiku não tem.) */
  serverFallback: boolean;
}

export const CLAUDE_MODELS: ClaudeModelInfo[] = [
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', sub: 'equilíbrio entre qualidade, rapidez e custo (padrão)', serverFallback: true },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', sub: 'o mais capaz — respostas mais finas, mais caro', serverFallback: true },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', sub: 'o mais rápido e barato', serverFallback: false },
];

export const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-5-5';

/** Profundidade do raciocínio (output_config.effort). Mais alto = melhor, mais lento e mais caro. */
export type ClaudeEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export const CLAUDE_EFFORTS: { id: ClaudeEffort; label: string; sub: string }[] = [
  { id: 'low', label: 'Baixo', sub: 'o mais rápido e barato' },
  { id: 'medium', label: 'Médio', sub: 'bom equilíbrio (padrão)' },
  { id: 'high', label: 'Alto', sub: 'pensa mais antes de responder' },
  { id: 'xhigh', label: 'Muito alto', sub: 'mais lento e mais caro' },
  { id: 'max', label: 'Máximo', sub: 'o mais lento e caro; raramente compensa aqui' },
];

export const DEFAULT_CLAUDE_EFFORT: ClaudeEffort = 'medium';

export function claudeEffort(id: string | null | undefined): ClaudeEffort {
  return CLAUDE_EFFORTS.find((e) => e.id === id)?.id ?? DEFAULT_CLAUDE_EFFORT;
}

export function claudeModelInfo(id: string | null | undefined): ClaudeModelInfo {
  return CLAUDE_MODELS.find((m) => m.id === id) ?? CLAUDE_MODELS[0];
}

// ——— Chave (guardada cifrada, separada da do Gemini) ———

const KEY = 'comentor.anthropicApiKey';

export async function saveClaudeKey(apiKey: string): Promise<void> {
  await SecureStore.setItemAsync(KEY, apiKey.trim(), { keychainAccessible: SecureStore.WHEN_UNLOCKED });
}

export async function getClaudeKey(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(KEY);
  } catch {
    return null;
  }
}

export async function deleteClaudeKey(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}

// ——— Chamada ———

export interface ClaudeTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface ClaudeRequest {
  model: string;
  /** Profundidade do raciocínio; padrão 'medium'. */
  effort?: string;
  system?: string;
  turns: ClaudeTurn[];
  /** Tamanho esperado da RESPOSTA visível (o teto real soma folga para o raciocínio). */
  maxOutputTokens: number;
  timeoutMs?: number;
}

interface ApiResponse {
  content?: { type: string; text?: string }[];
  stop_reason?: string | null;
  stop_details?: { category?: string | null; explanation?: string | null } | null;
  error?: { type?: string; message?: string };
}

export class ClaudeError extends Error {
  status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'ClaudeError';
    this.status = status;
  }
}

function friendly(status: number, msg: string): string {
  if (status === 401) return 'chave da Anthropic inválida';
  if (status === 403) return 'esta chave não tem permissão para este modelo';
  if (status === 404) return 'modelo não encontrado para esta chave';
  if (status === 429) return 'limite de uso da Anthropic atingido — tente daqui a pouco';
  if (status === 529 || status >= 500) return 'a Anthropic está sobrecarregada — tente de novo';
  return msg || `HTTP ${status}`;
}

async function post(apiKey: string, body: object, beta: string | null, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': API_VERSION,
        ...(beta ? { 'anthropic-beta': beta } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Junta turnos seguidos do mesmo papel e garante que a conversa começa pelo usuário. */
function normalizeTurns(turns: ClaudeTurn[]): { role: 'user' | 'assistant'; content: string }[] {
  const out: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const t of turns) {
    const text = t.text.trim();
    if (!text) continue;
    const last = out[out.length - 1];
    if (last && last.role === t.role) last.content += `\n\n${text}`;
    else out.push({ role: t.role, content: text });
  }
  // A API exige que a conversa comece pelo usuário. Em vez de descartar a fala
  // inicial da Comentora (a pergunta-âncora da entrevista, o abridor do chat) —
  // o que deixava o Claude sem saber a que a pessoa está respondendo —, abre
  // com um turno neutro do usuário e mantém a fala dela.
  if (out.length && out[0].role !== 'user') out.unshift({ role: 'user', content: '[início da conversa]' });
  // Sem pré-preenchimento: a última mensagem tem de ser do usuário.
  while (out.length && out[out.length - 1].role !== 'user') out.pop();
  return out;
}

/**
 * Gera uma resposta de texto. Lança ClaudeError em falha (chave, limite, rede,
 * recusa, resposta vazia) — quem chama decide o texto de reserva.
 */
export async function claudeComplete(apiKey: string, req: ClaudeRequest): Promise<string> {
  const messages = normalizeTurns(req.turns);
  if (!messages.length) throw new ClaudeError('conversa vazia');
  const info = claudeModelInfo(req.model);
  const effort = claudeEffort(req.effort);
  // Respeita o teto de quem chama: um piso aqui fazia a requisição seguir (e ser
  // cobrada) depois que o chamador já tinha desistido e descartado o resultado.
  const timeoutMs = req.timeoutMs ?? 45_000;
  const base = {
    model: info.id,
    // folga para o raciocínio, que conta no mesmo teto
    max_tokens: Math.max(effort === 'low' ? 4096 : effort === 'medium' ? 8192 : 16000, req.maxOutputTokens * 4),
    output_config: { effort },
    ...(req.system ? { system: req.system } : {}),
    messages,
  };

  let useFallback = info.serverFallback;
  let lastErr: ClaudeError | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    let res: Response;
    try {
      res = await post(apiKey, useFallback ? { ...base, fallbacks: 'default' } : base, useFallback ? FALLBACK_BETA : null, timeoutMs);
    } catch (e) {
      const aborted = e instanceof Error && e.name === 'AbortError';
      lastErr = new ClaudeError(aborted ? 'o Claude demorou demais para responder' : 'sem conexão com a Anthropic');
      // Estourou o tempo: desiste já, com ou sem teto do chamador. Repetir
      // multiplicaria a espera (3×45 s ≈ 2 min em "pensando…" no chat/soneca) e
      // cobraria de novo uma requisição lenta que tende a ficar lenta outra vez.
      // Só a falha rápida de rede (sem abort) merece nova tentativa.
      if (aborted) throw lastErr;
      continue;
    }
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as ApiResponse;
      const msg = j.error?.message ?? '';
      // A conta pode não ter o recurso de reserva: tenta uma vez sem ele.
      if (useFallback && res.status === 400 && /fallback|beta/i.test(msg)) {
        useFallback = false;
        continue;
      }
      lastErr = new ClaudeError(friendly(res.status, msg), res.status);
      if (res.status === 429 || res.status === 529 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        continue;
      }
      throw lastErr;
    }
    const j = (await res.json()) as ApiResponse;
    if (j.stop_reason === 'refusal') {
      throw new ClaudeError(`o Claude recusou este pedido${j.stop_details?.category ? ` (${j.stop_details.category})` : ''}`);
    }
    const text = (j.content ?? [])
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text as string)
      .join('')
      .trim();
    if (!text) {
      lastErr = new ClaudeError(j.stop_reason === 'max_tokens' ? 'resposta cortada pelo limite de tokens' : 'resposta vazia');
      continue;
    }
    return text;
  }
  throw lastErr ?? new ClaudeError('todas as tentativas falharam');
}

/** Valida a chave sem gastar tokens: lista os modelos e confere se o escolhido existe. */
export async function testClaudeKey(apiKey: string, model: string): Promise<{ ok: boolean; error?: string }> {
  const key = apiKey.trim();
  if (!key) return { ok: false, error: 'chave vazia' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(`${MODELS_URL}/${encodeURIComponent(claudeModelInfo(model).id)}`, {
      headers: { 'x-api-key': key, 'anthropic-version': API_VERSION },
      signal: controller.signal,
    });
    if (res.ok) return { ok: true };
    const j = (await res.json().catch(() => ({}))) as ApiResponse;
    return { ok: false, error: friendly(res.status, j.error?.message ?? '') };
  } catch (e) {
    return { ok: false, error: e instanceof Error && e.name === 'AbortError' ? 'tempo esgotado' : 'sem conexão com a Anthropic' };
  } finally {
    clearTimeout(timer);
  }
}
