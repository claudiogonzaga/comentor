import type { IntensityLevel, OwlMood } from '../types';

export interface IntensityConfig {
  level: IntensityLevel;
  title: string;
  notificationTitle: string;
  notificationBody: string;
  owlMood: OwlMood;
  technique: string;
}

export const INTENSITY_LEVELS: Record<IntensityLevel, IntensityConfig> = {
  1: {
    level: 1,
    title: 'Sussurro gentil',
    notificationTitle: '🦉 Hora da cama',
    notificationBody: 'Sua cama está te esperando. Vem cá um instante.',
    owlMood: 'calm',
    technique: 'Nudge positivo + framing de ganho',
  },
  2: {
    level: 2,
    title: 'Lembrete amigável',
    notificationTitle: '🦉 Ainda acordado?',
    notificationBody: 'A manhã de amanhã está sendo decidida agora. Vem cá um instante.',
    owlMood: 'calm',
    technique: 'Aversão à perda + dados leves',
  },
  3: {
    level: 3,
    title: 'Alerta preocupado',
    notificationTitle: '🦉 Seu corpo pede descanso',
    notificationBody: 'Cada minuto de cama agora volta em foco amanhã. Toca aqui.',
    owlMood: 'worried',
    technique: 'Urgência + consequências + identidade',
  },
  4: {
    level: 4,
    title: 'Confronto firme',
    notificationTitle: '🦉 Pergunta sincera',
    notificationBody: 'O que você está fazendo agora vale mais do que a sua manhã? Toca aqui.',
    owlMood: 'serious',
    technique: 'Reflexão socrática + compromisso',
  },
  5: {
    level: 5,
    title: 'Ultimato compassivo',
    notificationTitle: '🦉 Ainda dá',
    notificationBody: 'Não é tarde para salvar parte da noite. Vai agora.',
    owlMood: 'serious',
    technique: 'Paradoxo terapêutico',
  },
};

export const getIntensityForMinutesLate = (
  minutesLate: number,
  intervalMinutes: number,
): IntensityLevel => {
  if (minutesLate <= 0) return 1;
  const stepsLate = Math.floor(minutesLate / intervalMinutes);
  const level = Math.min(5, Math.max(1, stepsLate + 1));
  return level as IntensityLevel;
};
