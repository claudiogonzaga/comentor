// Os pilares do Aspis como texto para o prompt da Comentora. Fica fora do
// bootstrap de propósito: o coach importa isto, e o bootstrap importa o store da
// Comentora, que importa o coach — este arquivo não pode entrar nesse ciclo.

import AsyncStorage from '@react-native-async-storage/async-storage';

import { DEFAULT_PILLARS } from './constants/defaults';
import type { Pillar } from './types';

export async function pillarsForCoach(): Promise<string> {
  try {
    const raw = await AsyncStorage.getItem('aspis:pillars');
    const pillars = raw ? (JSON.parse(raw) as Pillar[]) : DEFAULT_PILLARS;
    return pillars.map((p) => `- ${p.nome}${p.descricao ? `: ${p.descricao}` : ''}`).join('\n');
  } catch {
    return '';
  }
}
