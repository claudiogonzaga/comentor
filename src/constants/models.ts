// Catálogo de modelos LLM locais que rodam no celular via llama.rn (GGUF).
//
// IMPORTANTE: estes URLs apontam pra arquivos públicos no Hugging Face que NÃO
// exigem autenticação. Se algum dia precisarem migrar pra mirror próprio
// (ex: anexar GGUFs como release asset no GitHub), basta atualizar `downloadUrl`.
//
// Tamanhos aproximados para o usuário ver antes de baixar — o tamanho real é
// confirmado via Content-Length no início do download.

import type { LocalModelId, LocalModelInfo } from '../types';

export const LOCAL_MODELS: Record<LocalModelId, LocalModelInfo> = {
  'gemma-4-e4b': {
    id: 'gemma-4-e4b',
    label: 'Gemma 4 E4B',
    vendor: 'Google',
    description:
      'Otimizado especificamente para celular. Excelente em português e instrução. Sem reasoning explícito.',
    downloadUrl:
      'https://huggingface.co/unsloth/gemma-4-E4B-it-GGUF/resolve/main/gemma-4-E4B-it-Q4_K_M.gguf',
    fileName: 'gemma-4-E4B-it-Q4_K_M.gguf',
    sizeBytes: 4_980_000_000,
    contextWindow: 32_768,
    hasThinking: false,
    chatTemplate: 'gemma',
  },
  'qwen3-4b-thinking-2507': {
    id: 'qwen3-4b-thinking-2507',
    label: 'Qwen3 4B Thinking 2507',
    vendor: 'Alibaba',
    description:
      'Reasoning explícito (thinking mode), forte em raciocínio lógico. Ideal para argumentação persuasiva.',
    downloadUrl:
      'https://huggingface.co/unsloth/Qwen3-4B-Thinking-2507-GGUF/resolve/main/Qwen3-4B-Thinking-2507-Q4_K_M.gguf',
    fileName: 'Qwen3-4B-Thinking-2507-Q4_K_M.gguf',
    sizeBytes: 2_500_000_000,
    contextWindow: 65_536,
    hasThinking: true,
    chatTemplate: 'chatml',
  },
  'qwen3.5-4b': {
    id: 'qwen3.5-4b',
    label: 'Qwen3.5 4B',
    vendor: 'Alibaba',
    description:
      'Versão mais recente da família Qwen. Equilíbrio entre velocidade e qualidade de instrução.',
    downloadUrl:
      'https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/main/Qwen3.5-4B-Q4_K_M.gguf',
    fileName: 'Qwen3.5-4B-Q4_K_M.gguf',
    sizeBytes: 2_500_000_000,
    contextWindow: 32_768,
    hasThinking: false,
    chatTemplate: 'chatml',
  },
};

export const LOCAL_MODEL_LIST: LocalModelInfo[] = Object.values(LOCAL_MODELS);

export const DEFAULT_LOCAL_MODEL: LocalModelId = 'qwen3-4b-thinking-2507';

export function getLocalModel(id: LocalModelId): LocalModelInfo {
  return LOCAL_MODELS[id];
}

export function formatModelSize(bytes: number): string {
  const gb = bytes / 1_000_000_000;
  return gb < 10 ? `${gb.toFixed(1)} GB` : `${Math.round(gb)} GB`;
}
