// Atualização contínua do Aspis: o feed se refaz sozinho de hora em hora, sem
// esperar você abrir a lista ou puxar para atualizar.
//
//  - YouTube: uma tarefa do Android em segundo plano (expo-background-task, por
//    baixo o WorkManager) roda mesmo com o app fechado; com o app aberto, uma
//    checagem a cada 15 min cobre o que o sistema adiar.
//  - X: a leitura usa uma página aberta com a sua sessão (XHarvester), que não
//    existe com o app fechado. Roda com o app em uso, em qualquer aba: ao abrir,
//    ao voltar para ele e de hora em hora.
//
// Uma trava só, a mesma do botão Atualizar: duas rodadas nunca se cruzam.

import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { AppState } from 'react-native';
import { create } from 'zustand';

import { claudeForTask } from '../../services/aiTasks';
import { getAccessToken } from './auth';
import * as db from './db';
import { refreshFeed, refreshX, type RefreshResult } from './pipeline';
import { useXStore } from './x';
import { useAppStore } from '../store/useAppStore';
import { useTranscribeStore } from '../store/useTranscribeStore';

export type RefreshSource = 'youtube' | 'x';

const TASK = 'aspis-youtube-refresh';
const EVERY_MS = 60 * 60 * 1000;
const TICK_MS = 15 * 60 * 1000;

interface RefreshState {
  /** A fonte em atualização agora, ou null. */
  busy: RefreshSource | null;
  /** Rodada pedida pelo botão (mostra o resultado) ou automática (silenciosa). */
  manual: boolean;
  /** "Lendo as suas inscrições…", "Analisando… 3/12" etc. */
  progress: string | null;
}

export const useRefreshStore = create<RefreshState>(() => ({ busy: null, manual: false, progress: null }));

export class RefreshBusy extends Error {
  constructor() {
    super('Atualização já em andamento.');
    this.name = 'RefreshBusy';
  }
}

function brainOptions() {
  const s = useAppStore.getState();
  return { apiKey: s.geminiKey, model: s.model, pillars: s.pillars, rules: s.rules, noteLang: s.noteLang, learnedPrefs: s.learnedPrefs };
}

/** Há chave para analisar (a do Gemini ou o Claude escolhido para o feed)? */
export async function hasBrain(): Promise<boolean> {
  return !!useAppStore.getState().geminiKey || !!(await claudeForTask('aspisFeed'));
}

async function exclusive<T>(source: RefreshSource, manual: boolean, run: () => Promise<T>): Promise<T> {
  if (useRefreshStore.getState().busy) throw new RefreshBusy();
  useRefreshStore.setState({ busy: source, manual, progress: null });
  try {
    return await run();
  } finally {
    useRefreshStore.setState({ busy: null, manual: false, progress: null });
  }
}

const say = (progress: string) => useRefreshStore.setState({ progress });

/** Uma rodada do YouTube: inscrições → vídeos novos → análise → banco. */
export function runYouTube(manual = false): Promise<RefreshResult> {
  return exclusive('youtube', manual, async () => {
    const token = await getAccessToken();
    const { period, minStars } = useAppStore.getState();
    const result = await refreshFeed(token, brainOptions(), period, minStars, (p) => {
      if (p.stage === 'subs') say('Lendo as suas inscrições…');
      else if (p.stage === 'playlists') say(`Buscando vídeos novos… ${p.done}/${p.total} canais`);
      else say(`Sintetizando… ${p.done}/${p.total} vídeos`);
    });
    useAppStore.getState().bumpFeed();
    // vídeos sem legenda: transcreve no celular e refaz a triagem (só com o app aberto)
    if (AppState.currentState === 'active') useTranscribeStore.getState().runAuto();
    return result;
  });
}

/** Uma rodada do X: a timeline numa página invisível → análise → banco. */
export function runX(manual = false): Promise<RefreshResult> {
  return exclusive('x', manual, async () => {
    const { period, minStars } = useAppStore.getState();
    const result = await refreshX(brainOptions(), period, minStars, (p) =>
      say(p.stage === 'reading' ? 'Lendo a sua timeline do X…' : `Analisando… ${p.done}/${p.total} posts`),
    );
    useAppStore.getState().bumpFeed();
    return result;
  });
}

function stale(metaKey: 'last_run' | 'last_run_x'): boolean {
  const last = Date.parse(db.getMeta(metaKey) || '');
  return !Number.isFinite(last) || Date.now() - last >= EVERY_MS;
}

/** As fontes vencidas (mais de 1 h) e prontas para rodar sozinhas, sem abrir login nem erro. */
async function autoTick(withX: boolean): Promise<void> {
  if (useRefreshStore.getState().busy || !(await hasBrain())) return;
  if (useAppStore.getState().user && stale('last_run')) {
    await runYouTube().catch((e) => console.warn('[aspis] atualização do YouTube:', e));
  }
  if (withX && useXStore.getState().connected && stale('last_run_x') && AppState.currentState === 'active') {
    await runX().catch((e) => console.warn('[aspis] atualização do X:', e));
  }
}

// Com o app fechado, o Android chama esta tarefa (mais ou menos de hora em hora,
// quando houver rede): sobe o Aspis e roda o YouTube se a última rodada venceu.
TaskManager.defineTask(TASK, async () => {
  try {
    const { startAspis } = await import('../bootstrap');
    await startAspis(); // o init do Aspis já restaura o login do Google
    await autoTick(false);
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (e) {
    console.warn('[aspis] tarefa em segundo plano:', e);
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

let started = false;

/** Liga a atualização contínua (chamado uma vez, depois do init do Aspis). */
export function startAutoRefresh(): void {
  if (started) return;
  started = true;
  useXStore.getState().load();
  BackgroundTask.registerTaskAsync(TASK, { minimumInterval: 60 }).catch((e) =>
    console.warn('[aspis] não registrou a tarefa em segundo plano:', e),
  );
  const tick = () => void autoTick(true);
  setTimeout(tick, 20_000); // depois da abertura, sem disputar o início do app
  setInterval(tick, TICK_MS);
  AppState.addEventListener('change', (s) => {
    if (s === 'active') tick();
  });
}
