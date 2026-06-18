import {
  getUserConfig,
  listBreathingCustomSounds,
  listReadAloudTexts,
  listYogaNidraSounds,
} from './database';
import { getBreathingSound, type BreathingSoundId } from '../constants/breathingSounds';
import type { QueueItem } from '../store/useMediaQueue';

// Resolve as ATIVIDADES da Home (respiração, ioga nidra, leia para mim) em
// fontes de áudio prontas para a fila (useMediaQueue). Cada atividade vira UM
// item; se faltar o áudio necessário (ex.: nenhum Ioga Nidra subido), entra um
// aviso e a atividade é pulada.

export type ActivityKind = 'breathing' | 'yoganidra' | 'readaloud';

export const ACTIVITY_LABEL: Record<ActivityKind, string> = {
  breathing: 'Respiração',
  yoganidra: 'Ioga Nidra',
  readaloud: 'Leia para mim',
};

const DEFAULT_BREATHING_MINUTES = 16;

/** Fonte de áudio da RESPIRAÇÃO (asset embutido ou arquivo próprio do usuário). */
async function breathingItem(): Promise<{ item?: QueueItem; warning?: string }> {
  const config = await getUserConfig();
  const id = config.breathingSoundId ?? 'cello';
  const minutes = Math.max(1, config.breathingDurationMinutes ?? DEFAULT_BREATHING_MINUTES);
  const stopAfterMs = minutes * 60000;
  let source: number | { uri: string } | null = null;
  if (id.startsWith('custom:')) {
    const cid = parseInt(id.slice('custom:'.length), 10);
    const list = await listBreathingCustomSounds();
    const uri = list.find((s) => s.id === cid)?.uri ?? null;
    source = uri ? { uri } : null;
  } else {
    source = getBreathingSound(id as BreathingSoundId).asset ?? null;
  }
  if (source == null) return { warning: 'Respiração: som indisponível.' };
  return { item: { label: ACTIVITY_LABEL.breathing, source, loop: true, stopAfterMs } };
}

/** Fonte de áudio da IOGA NIDRA (selecionada na config, ou a mais recente). */
async function yogaNidraItem(): Promise<{ item?: QueueItem; warning?: string }> {
  const config = await getUserConfig();
  const list = await listYogaNidraSounds();
  if (!list.length) {
    return { warning: 'Ioga Nidra: nenhum áudio enviado — suba um arquivo na tela de Ioga Nidra.' };
  }
  const chosen =
    list.find((s) => s.id === config.yogaNidraSoundId) ?? list[list.length - 1];
  return { item: { label: ACTIVITY_LABEL.yoganidra, source: { uri: chosen.uri } } };
}

/** Fonte de áudio do LEIA PARA MIM (texto salvo mais recente que já tem áudio). */
async function readAloudItem(): Promise<{ item?: QueueItem; warning?: string }> {
  const texts = await listReadAloudTexts(); // já vem ordenado por mais recente
  const withAudio = texts.find((t) => t.audioUri);
  if (!withAudio?.audioUri) {
    return {
      warning:
        'Leia para mim: nenhum áudio salvo — gere e salve um áudio em "Leia para mim" antes.',
    };
  }
  return { item: { label: `${ACTIVITY_LABEL.readaloud}: ${withAudio.title}`, source: { uri: withAudio.audioUri } } };
}

export async function resolveActivities(
  kinds: ActivityKind[],
): Promise<{ items: QueueItem[]; warnings: string[] }> {
  const items: QueueItem[] = [];
  const warnings: string[] = [];
  for (const k of kinds) {
    const r =
      k === 'breathing'
        ? await breathingItem()
        : k === 'yoganidra'
          ? await yogaNidraItem()
          : await readAloudItem();
    if (r.item) items.push(r.item);
    if (r.warning) warnings.push(r.warning);
  }
  return { items, warnings };
}
