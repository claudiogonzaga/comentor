// O MODELO E O RACIOCÍNIO DE CADA TAREFA DE IA, no esquema do Grafê ("Configurar a
// IA"): esta tabela é o padrão, e a pessoa escolhe na tela o que quiser mudar. Só o
// que difere do padrão é gravado.
//
// Vale para o Claude. No Gemini, a Comentora usa o modelo de Cérebro e Voz, e o
// Aspis, o dos ajustes dele. Claude escolhido mas sem chave cai no Gemini.

import { claudeEffort, claudeModelInfo, DEFAULT_CLAUDE_EFFORT, DEFAULT_CLAUDE_MODEL, getClaudeKey } from './claude';
import { getKV, getUserConfig, setKV } from './database';

export type AiTaskId = 'coach' | 'chat' | 'interview' | 'aspisFeed' | 'aspisVideo' | 'aspisAsk' | 'aspisCheck' | 'aspisSimple';

export interface AiTaskInfo {
  id: AiTaskId;
  label: string;
  sub: string;
  /** null: segue o modelo geral da Comentora (o escolhido na configuração inicial). */
  model: string | null;
  effort: string | null;
}

export const AI_TASKS: AiTaskInfo[] = [
  { id: 'coach', label: 'Comentora · cobranças e argumentos', sub: 'o que ela diz nos lembretes, nas insistências e na soneca', model: null, effort: null },
  { id: 'chat', label: 'Comentora · conversa', sub: 'o chat com ela', model: null, effort: null },
  { id: 'interview', label: 'Comentora · entrevista', sub: 'a entrevista inicial e a extração do que você respondeu', model: null, effort: null },
  // A triagem roda em dezenas de vídeos a cada busca: o Haiku custa um vigésimo do Sonnet.
  { id: 'aspisFeed', label: 'Aspis · triagem do feed', sub: 'nota e síntese de cada vídeo novo', model: 'claude-haiku-5-5', effort: 'medium' },
  { id: 'aspisVideo', label: 'Aspis · vídeo compartilhado', sub: 'a análise do vídeo que você manda ao app', model: 'claude-sonnet-5-5', effort: 'medium' },
  { id: 'aspisAsk', label: 'Aspis · perguntas sobre o vídeo', sub: 'a caixa de perguntas da síntese', model: 'claude-sonnet-5-5', effort: 'medium' },
  { id: 'aspisCheck', label: 'Aspis · checagem externa', sub: 'busca na web para confirmar o que o vídeo diz', model: 'claude-sonnet-5-5', effort: 'medium' },
  { id: 'aspisSimple', label: 'Aspis · cartões e perfil', sub: 'flashcards e o que ele aprende com o que você pula', model: 'claude-haiku-5-5', effort: 'low' },
];

export interface AiTaskChoice {
  model: string;
  effort: string;
  defaultModel: string;
  defaultEffort: string;
}

const KEY = 'ai_tasks';

type Saved = Partial<Record<AiTaskId, { model?: string; effort?: string }>>;

async function readSaved(): Promise<Saved> {
  try {
    const raw = await getKV(KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as Saved) : {};
  } catch {
    return {};
  }
}

/** O que vale agora em cada tarefa: a escolha da pessoa ou o padrão. */
export async function loadAiTaskChoices(): Promise<Record<AiTaskId, AiTaskChoice>> {
  const saved = await readSaved();
  let generalModel = DEFAULT_CLAUDE_MODEL;
  let generalEffort: string = DEFAULT_CLAUDE_EFFORT;
  try {
    const c = await getUserConfig();
    generalModel = c.claudeModel || generalModel;
    generalEffort = c.claudeEffort || generalEffort;
  } catch {
    /* sem config legível: os padrões */
  }
  const out = {} as Record<AiTaskId, AiTaskChoice>;
  for (const t of AI_TASKS) {
    const defaultModel = claudeModelInfo(t.model ?? generalModel).id;
    const defaultEffort = claudeEffort(t.effort ?? generalEffort);
    const s = saved[t.id] ?? {};
    out[t.id] = {
      model: s.model ? claudeModelInfo(s.model).id : defaultModel,
      effort: s.effort ? claudeEffort(s.effort) : defaultEffort,
      defaultModel,
      defaultEffort,
    };
  }
  return out;
}

let writes: Promise<unknown> = Promise.resolve();

/** Grava a escolha de uma tarefa; o que for igual ao padrão não fica gravado. Uma gravação por vez. */
export function setAiTaskChoice(id: AiTaskId, patch: { model?: string; effort?: string }): Promise<void> {
  const write = async () => {
    const [saved, now] = await Promise.all([readSaved(), loadAiTaskChoices()]);
    const cur = now[id];
    const model = patch.model ?? cur.model;
    const effort = patch.effort ?? cur.effort;
    const entry = {
      ...(model !== cur.defaultModel ? { model } : {}),
      ...(effort !== cur.defaultEffort ? { effort } : {}),
    };
    if (Object.keys(entry).length) saved[id] = entry;
    else delete saved[id];
    await setKV(KEY, JSON.stringify(saved));
  };
  const done = writes.then(write, write);
  writes = done;
  return done;
}

/** O Claude para esta tarefa, se ele é o provedor escolhido e há chave; senão, null. */
export async function claudeForTask(id: AiTaskId): Promise<{ apiKey: string; model: string; effort: string } | null> {
  try {
    const c = await getUserConfig();
    if (c.aiProvider !== 'claude') return null;
    const apiKey = await getClaudeKey();
    if (!apiKey) return null;
    const { model, effort } = (await loadAiTaskChoices())[id];
    return { apiKey, model, effort };
  } catch {
    return null;
  }
}
