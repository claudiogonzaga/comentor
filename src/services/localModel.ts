// Wrapper sobre llama.rn para inferência on-device via GGUF.
//
// Carrega o modelo sob demanda (não no startup) e descarrega após período
// de ociosidade pra liberar RAM. Detecta thinking mode automaticamente quando
// o modelo suporta (ex: Qwen3-4B-Thinking) e remove tokens <think>...</think>
// da resposta final entregue ao usuário.

import { initLlama, type LlamaContext } from 'llama.rn';
import type { LocalModelId, LocalModelInfo } from '../types';
import { getLocalModel } from '../constants/models';
import { getModelLocalPath, isModelDownloaded } from './modelDownload';

interface LoadedModel {
  id: LocalModelId;
  info: LocalModelInfo;
  ctx: LlamaContext;
  lastUsedAt: number;
}

let loaded: LoadedModel | null = null;
let loadingPromise: Promise<LoadedModel> | null = null;

const IDLE_RELEASE_MS = 5 * 60 * 1000; // descarrega após 5min sem uso
let idleTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleIdleRelease() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    void releaseModel();
  }, IDLE_RELEASE_MS);
}

export async function ensureModelLoaded(modelId: LocalModelId): Promise<LoadedModel> {
  if (loaded && loaded.id === modelId) {
    loaded.lastUsedAt = Date.now();
    scheduleIdleRelease();
    return loaded;
  }
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    if (loaded && loaded.id !== modelId) {
      await releaseModel();
    }
    const info = getLocalModel(modelId);
    const downloaded = await isModelDownloaded(modelId);
    if (!downloaded) {
      throw new Error('Modelo não baixado. Vá em Configurações para baixar.');
    }
    const path = getModelLocalPath(modelId);
    const ctx = await initLlama({
      model: path,
      n_ctx: Math.min(8192, info.contextWindow),
      n_batch: 512,
      n_gpu_layers: 0, // Android: CPU por padrão. GPU offload depende de Vulkan/build.
      use_mlock: false,
    });
    const next: LoadedModel = { id: modelId, info, ctx, lastUsedAt: Date.now() };
    loaded = next;
    scheduleIdleRelease();
    return next;
  })();

  try {
    return await loadingPromise;
  } finally {
    loadingPromise = null;
  }
}

export async function releaseModel(): Promise<void> {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  if (!loaded) return;
  try {
    await loaded.ctx.release();
  } catch (err) {
    console.warn('Erro ao descarregar modelo local:', err);
  }
  loaded = null;
}

export interface LocalChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface GenerationOptions {
  maxTokens?: number;
  temperature?: number;
  topP?: number;
}

function stripThinking(text: string): string {
  // Remove blocos <think>...</think> que modelos thinking emitem antes da
  // resposta final. Cobertura: <think>...</think>, <thinking>...</thinking>,
  // e variações em maiúsculas.
  return text
    .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '')
    .trim();
}

export async function generateLocal(
  modelId: LocalModelId,
  messages: LocalChatMessage[],
  options: GenerationOptions = {},
): Promise<string> {
  const { ctx, info } = await ensureModelLoaded(modelId);

  const isThinking = info.hasThinking;
  // Qwen3-4B-Thinking usa params recomendados específicos; outros usam defaults
  // mais agressivos pra criatividade na coaching.
  const temperature = options.temperature ?? (isThinking ? 0.6 : 0.85);
  const topP = options.topP ?? (isThinking ? 0.95 : 0.95);
  const nPredict = options.maxTokens ?? (isThinking ? 1024 : 400);

  const result = await ctx.completion({
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    n_predict: nPredict,
    temperature,
    top_p: topP,
    top_k: isThinking ? 20 : 40,
    stop: ['</s>', '<|im_end|>', '<end_of_turn>'],
  });

  if (loaded) loaded.lastUsedAt = Date.now();
  scheduleIdleRelease();

  const raw = result.text ?? '';
  return stripThinking(raw);
}

export async function isModelReady(modelId: LocalModelId): Promise<boolean> {
  return isModelDownloaded(modelId);
}
