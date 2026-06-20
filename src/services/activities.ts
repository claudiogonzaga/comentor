import {
  getUserConfig,
  listBreathingCustomSounds,
  listReadAloudTexts,
  listYogaNidraSounds,
} from './database';
import {
  BREATHING_SOUNDS,
  getBreathingSound,
  type BreathingSoundId,
} from '../constants/breathingSounds';
import type { QueueItem } from '../store/useMediaQueue';

// Resolve as ATIVIDADES da sequência (respiração, ioga nidra, leia para mim) em
// fontes de áudio prontas para a fila (useMediaQueue). Cada passo aponta para
// UM arquivo específico (ref): o usuário escolhe QUAL áudio/texto salvo tocar, e
// pode repetir (ex.: vários "Leia para mim"). Se o arquivo não existir mais,
// entra um aviso e o passo é pulado.

export type ActivityKind = 'breathing' | 'yoganidra' | 'readaloud';

export const ACTIVITY_LABEL: Record<ActivityKind, string> = {
  breathing: 'Respiração',
  yoganidra: 'Ioga Nidra',
  readaloud: 'Leia para mim',
};

/** Um passo da sequência: tipo + referência ao arquivo escolhido + rótulo. */
export interface SeqStep {
  kind: ActivityKind;
  /** breathing: id do som ('cello' | 'custom:<id>'); yoga/leia: id numérico. */
  ref: string | number;
  label: string;
}

/** Opção escolhível no seletor de um tipo de atividade. */
export interface ActivityOption {
  ref: string | number;
  label: string;
}

const DEFAULT_BREATHING_MINUTES = 16;

/** Opções disponíveis para um tipo (sons/áudios/textos salvos). */
export async function listActivityOptions(kind: ActivityKind): Promise<ActivityOption[]> {
  if (kind === 'breathing') {
    const embedded: ActivityOption[] = BREATHING_SOUNDS.filter((s) => s.asset != null).map((s) => ({
      ref: s.id,
      label: s.name,
    }));
    const custom = await listBreathingCustomSounds();
    return [...embedded, ...custom.map((c) => ({ ref: `custom:${c.id}`, label: c.name }))];
  }
  if (kind === 'yoganidra') {
    const list = await listYogaNidraSounds();
    return list.map((s) => ({ ref: s.id, label: s.name }));
  }
  // readaloud: só textos que JÁ têm áudio gerado (toca na hora).
  const texts = await listReadAloudTexts();
  return texts.filter((t) => t.audioUri).map((t) => ({ ref: t.id, label: t.title }));
}

async function resolveStep(step: SeqStep): Promise<{ item?: QueueItem; warning?: string }> {
  if (step.kind === 'breathing') {
    const config = await getUserConfig();
    const minutes = Math.max(1, config.breathingDurationMinutes ?? DEFAULT_BREATHING_MINUTES);
    const id = String(step.ref);
    let source: number | { uri: string } | null = null;
    let name = step.label;
    if (id.startsWith('custom:')) {
      const cid = parseInt(id.slice('custom:'.length), 10);
      const list = await listBreathingCustomSounds();
      const s = list.find((x) => x.id === cid);
      source = s ? { uri: s.uri } : null;
      name = s?.name ?? name;
    } else {
      source = getBreathingSound(id as BreathingSoundId).asset ?? null;
    }
    if (source == null) return { warning: `Respiração: som "${name}" indisponível.` };
    return {
      item: {
        label: `${ACTIVITY_LABEL.breathing}: ${name}`,
        source,
        loop: true,
        stopAfterMs: minutes * 60000,
      },
    };
  }
  if (step.kind === 'yoganidra') {
    const list = await listYogaNidraSounds();
    const s = list.find((x) => x.id === step.ref);
    if (!s) return { warning: `Ioga Nidra: "${step.label}" não encontrado.` };
    return { item: { label: `${ACTIVITY_LABEL.yoganidra}: ${s.name}`, source: { uri: s.uri } } };
  }
  // readaloud
  const texts = await listReadAloudTexts();
  const t = texts.find((x) => x.id === step.ref);
  if (!t?.audioUri) return { warning: `Leia para mim: "${step.label}" sem áudio salvo.` };
  return {
    item: { label: `${ACTIVITY_LABEL.readaloud}: ${t.title}`, source: { uri: t.audioUri } },
  };
}

export async function resolveSteps(
  steps: SeqStep[],
): Promise<{ items: QueueItem[]; warnings: string[] }> {
  const items: QueueItem[] = [];
  const warnings: string[] = [];
  for (const s of steps) {
    const r = await resolveStep(s);
    if (r.item) items.push(r.item);
    if (r.warning) warnings.push(r.warning);
  }
  return { items, warnings };
}
