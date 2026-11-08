// SUGESTÕES PRONTAS para criar um hábito com um toque. Cada uma já vem com o que
// a pesquisa diz que faz o hábito pegar, e que quase ninguém escreve sozinho:
//  - a PISTA (o "quando"): um momento que já existe no dia — planos se-então
//    dobram a chance de a ação acontecer (Gollwitzer & Sheeran, 2006);
//  - a VERSÃO MÍNIMA para os dias ruins: manter a cadeia viva vale mais que a
//    dose cheia (é a repetição no mesmo contexto que automatiza; Lally 2010);
//  - num hábito de PARAR, a SUBSTITUIÇÃO: largar sem pôr nada no lugar deixa a
//    deixa sem resposta, e a resposta antiga volta.

import type { HabitInput } from '../types/habits';

export interface HabitTemplate {
  id: string;
  input: HabitInput;
}

/** Pistas prontas (chips). Guardadas em minúscula: entram no meio da frase do plano. */
export const CUE_CHIPS: string[] = [
  'Ao acordar',
  'Depois do café',
  'Depois de escovar os dentes',
  'Ao chegar ao trabalho',
  'Depois do almoço',
  'Ao chegar em casa',
  'Depois do jantar',
  'Antes de deitar',
];

/** Horário sugerido para cada pista (só preenche se a pessoa ainda não mexeu no horário). */
export const CUE_TIME: Record<string, string> = {
  'ao acordar': '07:00',
  'depois do café': '07:30',
  'depois de escovar os dentes': '07:15',
  'ao chegar ao trabalho': '08:30',
  'depois do almoço': '13:00',
  'ao chegar em casa': '18:30',
  'depois do jantar': '20:30',
  'antes de deitar': '22:30',
};

/** A pista como fica guardada: "Depois do café" → "depois do café". */
export function cueValue(chip: string): string {
  return chip ? chip.charAt(0).toLowerCase() + chip.slice(1) : chip;
}

export const DO_TEMPLATES: HabitTemplate[] = [
  {
    id: 'ler',
    input: {
      title: 'ler 10 páginas',
      kind: 'fazer',
      emoji: '📖',
      cue: 'depois do jantar',
      scheduleTime: '21:00',
      minimum: 'ler 1 página',
      planB: 'Se eu estiver sem o livro, leio no celular por 5 minutos',
      measure: 'quantidade',
      target: 10,
      unit: 'páginas',
    },
  },
  {
    id: 'agua',
    input: {
      title: 'beber um copo d’água',
      kind: 'fazer',
      emoji: '💧',
      cue: 'ao acordar',
      scheduleTime: '07:00',
      minimum: 'dar três goles',
      planB: 'Se não houver copo por perto, bebo direto da garrafa',
    },
  },
  {
    id: 'caminhar',
    input: {
      title: 'caminhar 20 minutos',
      kind: 'fazer',
      emoji: '🏃',
      cue: 'depois do almoço',
      scheduleTime: '13:00',
      minimum: 'caminhar 5 minutos',
      planB: 'Se chover, subo e desço escadas por 10 minutos',
    },
  },
  {
    id: 'meditar',
    input: {
      title: 'sentar em zazen 10 minutos',
      kind: 'fazer',
      emoji: '🧘',
      cue: 'ao acordar',
      scheduleTime: '07:15',
      minimum: 'três respirações conscientes',
      planB: 'Se a casa estiver agitada, sento no carro ou na varanda',
      action: 'zazen',
    },
  },
  {
    id: 'respirar',
    input: {
      title: 'fazer o exercício de respiração',
      kind: 'fazer',
      emoji: '🌬️',
      cue: 'antes de deitar',
      scheduleTime: '22:00',
      minimum: 'uma respiração 4-7-8',
      planB: 'Se eu já estiver deitado, faço ali mesmo, de olhos fechados',
      action: 'respiracao',
    },
  },
  {
    id: 'sol',
    input: {
      title: 'tomar sol de manhã',
      kind: 'fazer',
      emoji: '☀️',
      cue: 'depois do café',
      scheduleTime: '08:00',
      minimum: 'abrir a janela e olhar o céu por 1 minuto',
      planB: 'Se estiver nublado, saio assim mesmo: a luz do dia ainda conta',
    },
  },
  {
    id: 'telas',
    input: {
      title: 'desligar as telas 1 hora antes de dormir',
      kind: 'fazer',
      emoji: '🕶️',
      cue: 'depois do jantar',
      scheduleTime: '21:30',
      minimum: 'pôr o celular no modo noturno',
      planB: 'Se eu precisar trabalhar, uso os óculos de luz âmbar',
    },
  },
  {
    id: 'alongar',
    input: {
      title: 'alongar 5 minutos',
      kind: 'fazer',
      emoji: '💪',
      cue: 'ao chegar em casa',
      scheduleTime: '18:30',
      minimum: 'um alongamento de 30 segundos',
      planB: 'Se eu chegar tarde, alongo antes de deitar',
    },
  },
  {
    id: 'gratidao',
    input: {
      title: 'escrever três gratidões',
      kind: 'fazer',
      emoji: '✍️',
      cue: 'antes de deitar',
      scheduleTime: '22:30',
      minimum: 'escrever uma',
      planB: 'Se o caderno não estiver à mão, escrevo no celular',
    },
  },
  {
    id: 'nidra',
    input: {
      title: 'fazer a Ioga Nidra',
      kind: 'fazer',
      emoji: '🌙',
      cue: 'antes de deitar',
      scheduleTime: '22:30',
      minimum: '5 minutos deitado, de olhos fechados',
      action: 'ioga',
    },
  },
  {
    id: 'treino',
    input: {
      title: 'treinar',
      kind: 'fazer',
      emoji: '💪',
      cue: 'ao chegar em casa',
      scheduleTime: '18:30',
      minimum: '10 minutos de qualquer exercício',
      planB: 'Se eu não puder ir à academia, faço 15 minutos em casa',
      freq: 'semana',
      perWeek: 3,
    },
  },
  {
    id: 'ouvir',
    input: {
      title: 'ouvir um texto do Leia para mim',
      kind: 'fazer',
      emoji: '📖',
      cue: 'depois do almoço',
      scheduleTime: '13:30',
      minimum: 'ouvir 5 minutos',
      action: 'leia',
    },
  },
];

export const STOP_TEMPLATES: HabitTemplate[] = [
  {
    id: 'celular-cama',
    input: {
      title: 'usar o celular na cama',
      kind: 'parar',
      emoji: '📱',
      cue: 'antes de deitar',
      scheduleTime: '21:00',
      planB: 'deixar o celular carregando fora do quarto e ler um livro',
    },
  },
  {
    id: 'doce',
    input: {
      title: 'comer doce depois do almoço',
      kind: 'parar',
      emoji: '🍲',
      cue: 'depois do almoço',
      scheduleTime: '21:00',
      planB: 'tomar um café ou comer uma fruta',
    },
  },
  {
    id: 'redes-manha',
    input: {
      title: 'abrir as redes sociais ao acordar',
      kind: 'parar',
      emoji: '📱',
      cue: 'ao acordar',
      scheduleTime: '21:00',
      planB: 'beber um copo d’água e abrir a janela primeiro',
    },
  },
  {
    id: 'beliscar',
    input: {
      title: 'beliscar à noite',
      kind: 'parar',
      emoji: '🍲',
      cue: 'depois do jantar',
      scheduleTime: '21:00',
      planB: 'tomar um chá e escovar os dentes',
    },
  },
];

export function getTemplate(id: string | null | undefined): HabitTemplate | null {
  if (!id) return null;
  return [...DO_TEMPLATES, ...STOP_TEMPLATES].find((t) => t.id === id) ?? null;
}

/** Rótulo curto do chip da sugestão: "Ler 10 páginas". */
export function templateLabel(t: HabitTemplate): string {
  const s = t.input.title;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
