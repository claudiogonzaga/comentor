// A costura entre o Aspis e o resto do Áskesis.
//
// O Aspis mora em src/aspis/ com os próprios store, banco (aspis.db), tema e
// serviços; o que os dois lados compartilham passa por aqui:
//  - init: sobe o store do Aspis uma vez, depois do store da Comentora;
//  - a chave do Gemini é UMA só (a de Cérebro e Voz);
//  - os pilares do Aspis chegam à Comentora como objetivos de vida (pillarsText.ts).

import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';

import { useAppStore as useRootStore } from '../store/useAppStore';
import { getApiKey } from '../services/secureStore';
import { useAppStore } from './store/useAppStore';
import * as db from './services/db';
import { deleteAllMedia } from './services/media';
import { useMediaStore } from './store/useMediaStore';
import { useTranscribeStore } from './store/useTranscribeStore';

const NIGHT_GATE_KEY = 'aspis:nightGate';

let started = false;

/** Sobe o Aspis uma vez. Nunca lança: uma falha aqui não pode derrubar a Comentora. */
export async function startAspis(): Promise<void> {
  if (started) return;
  started = true;
  try {
    await useAppStore.getState().init();
    useMediaStore.getState().init();
    useTranscribeStore.getState().init();
    AppState.addEventListener('change', (s) => {
      if (s !== 'active') return;
      useMediaStore.getState().refresh();
      useTranscribeStore.getState().runAuto(); // retoma a triagem por transcrição
    });
    // Trocou a chave em Cérebro e Voz: o Aspis passa a usar a nova.
    useRootStore.subscribe((now, before) => {
      if (now.config === before.config) return;
      void getApiKey().then((key) => {
        const trimmed = key?.trim() ?? '';
        if (trimmed !== useAppStore.getState().geminiKey) useAppStore.setState({ geminiKey: trimmed });
      });
    });
  } catch (err) {
    console.warn('[aspis] init falhou:', err);
  }
}

/** O feed fecha na hora de dormir? Ligado por padrão; dá para desligar nos ajustes do Aspis. */
export async function getNightGateEnabled(): Promise<boolean> {
  return (await AsyncStorage.getItem(NIGHT_GATE_KEY).catch(() => null)) !== '0';
}

export async function setNightGateEnabled(on: boolean): Promise<void> {
  await AsyncStorage.setItem(NIGHT_GATE_KEY, on ? '1' : '0').catch(() => {});
}

/** Da hora de dormir até as 6h da manhã, o feed fica fechado. */
export function isSleepWindow(bedtime: string | undefined | null, now = new Date()): boolean {
  const [h, m] = (bedtime ?? '23:00').split(':').map((x) => parseInt(x, 10));
  if (!Number.isFinite(h)) return false;
  const bed = h * 60 + (Number.isFinite(m) ? m : 0);
  const cur = now.getHours() * 60 + now.getMinutes();
  const wake = 6 * 60;
  return bed <= wake ? cur >= bed && cur < wake : cur >= bed || cur < wake;
}

/** "Apagar todos os meus dados" vale também para o Aspis: banco, preferências, arquivos e login. */
export async function wipeAspisData(): Promise<void> {
  try {
    db.wipeAll();
    deleteAllMedia();
    const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith('aspis:'));
    await AsyncStorage.multiRemove(keys);
    await useAppStore.getState().googleSignOut?.();
  } catch (err) {
    console.warn('[aspis] apagar dados falhou:', err);
  }
}
