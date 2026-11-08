// O APP DE HÁBITOS (v1.130): tipos compartilhados entre os serviços e as telas.
//
// Um hábito mora na tabela `nudges` (estendida): a chave é o `type`. Os dois de
// fábrica continuam com os nomes antigos ('bluelight', 'breathing'); os criados
// pela pessoa recebem `h-<aleatório>`; os que vieram de "Meus hábitos" na
// migração, `h-m<id do lembrete>`. Remédios, suplementos, jejum e lembretes
// avulsos continuam na tabela `medications` e são os LEMBRETES — não se formam.

/** Fazer (criar um hábito) ou parar (largar um mau hábito). */
export type HabitKind = 'fazer' | 'parar';

/** Sim/não, ou uma quantidade com meta (páginas, copos, minutos…). */
export type HabitMeasure = 'sim' | 'quantidade';

/** Todo dia, em dias da semana escolhidos, ou X vezes por semana (qualquer dia). */
export type HabitFreq = 'diario' | 'dias' | 'semana';

/**
 * Como a coruja lembra:
 *  - auto: a insistência DIMINUI conforme o hábito se forma (padrão; é o que a
 *    pesquisa sustenta — lembrete garante repetição, mas atrapalha a automaticidade);
 *  - completo: sempre a escada inteira (antes, hora, pergunta, cobranças);
 *  - hora: só o aviso na hora;
 *  - nenhum: nenhum aviso; só o registro.
 */
export type HabitReminders = 'auto' | 'completo' | 'hora' | 'nenhum';

/** Ferramenta do app que É o hábito: ao terminá-la, o hábito se marca sozinho. */
export type HabitAction = 'respiracao' | 'ioga' | 'leia' | 'zazen';

/**
 * Fase do hábito (decide quanto a coruja lembra, no modo 'auto'):
 *  - aprendendo: força < 50% — a escada inteira;
 *  - firmando: força 50–80% — hora, pergunta e no máximo 2 cobranças;
 *  - quase: força ≥ 80% (ou automaticidade alta) — só o aviso na hora;
 *  - formado: graduado (força ≥ 90% E automaticidade ≥ 5,5/7) — silêncio; a cada
 *    14 dias, 4 perguntas para conferir. Cai de volta se a automaticidade baixar.
 */
export type HabitStage = 'aprendendo' | 'firmando' | 'quase' | 'formado';

export type HabitPeriod = 'manha' | 'tarde' | 'noite';

/**
 * Estado de um dia:
 *  - feito; minimo (fez a versão mínima — conta como feito); parcial (quantidade
 *    abaixo da meta — conta proporcionalmente);
 *  - folga: dia neutro (doente, viagem, descanso) — não sobe nem desce a força;
 *  - nao: não fiz (decisão) — num hábito de parar, é o DESLIZE;
 *  - sem_resposta: a coruja desistiu de cobrar;
 *  - vazio: passou sem registro;
 *  - fora: não era dia do hábito (ou estava pausado, ou antes de ele existir);
 *  - pendente: hoje, ainda sem registro.
 */
export type HabitDayStatus =
  | 'feito'
  | 'minimo'
  | 'parcial'
  | 'folga'
  | 'nao'
  | 'sem_resposta'
  | 'vazio'
  | 'fora'
  | 'pendente';

/** O que a pessoa marca num dia (os demais estados são derivados). */
export type HabitMark = 'feito' | 'minimo' | 'folga' | 'nao';

/**
 * Um caractere por dia no `heat` (mapa de calor), o último é HOJE:
 * F feito · M mínimo · P parcial · O folga · N não fiz/deslize · X sem resposta ·
 * . sem registro · - fora (não programado, pausado, antes de existir) · H hoje pendente.
 */
export const HEAT_CHAR: Record<HabitDayStatus, string> = {
  feito: 'F',
  minimo: 'M',
  parcial: 'P',
  folga: 'O',
  nao: 'N',
  sem_resposta: 'X',
  vazio: '.',
  fora: '-',
  pendente: 'H',
};

export const HEAT_DAYS = 120;

export interface HabitDef {
  id: number;
  /** Chave estável (nudge_completions, sincronização, eventos). */
  type: string;
  /** A AÇÃO, curta: "ler 10 páginas", "comer doce" (num hábito de parar). */
  title: string;
  /** Detalhe livre (o antigo "corpo" do lembrete / a dosagem). */
  body: string;
  emoji: string | null;
  enabled: boolean;
  /** HH:MM — horário do aviso e da ordenação no dia (num hábito de parar, o da conferência da noite). */
  scheduleTime: string;
  orderIndex: number;
  /** RIGOROSO: vibra em pulsos até a resposta, sempre que houver aviso na hora. */
  strict: boolean;

  kind: HabitKind;
  /** A PISTA: "depois do café", "ao chegar em casa". Plano: "Quando {cue}, eu {title}". */
  cue: string | null;
  place: string | null;
  /** Versão mínima para dias ruins ("ler 1 página"). Conta como feito. */
  minimum: string | null;
  /**
   * Plano B. Num hábito de fazer: "Se {obstáculo}, então {alternativa}". Num de
   * parar: a SUBSTITUIÇÃO — "Quando sentir vontade, eu {isto}".
   */
  planB: string | null;
  /** Por quê / quem eu quero ser. */
  why: string | null;

  measure: HabitMeasure;
  target: number | null;
  unit: string | null;

  freq: HabitFreq;
  /** 0=domingo … 6=sábado. Em 'diario', os 7. */
  daysOfWeek: number[];
  /** Em 'semana': quantas vezes por semana (semana de segunda a domingo). */
  perWeek: number | null;

  reminders: HabitReminders;
  action: HabitAction | null;

  /** Pausado até este dia, inclusive (yyyy-MM-dd). '9999-12-31' = sem data. null = ativo. */
  pausedUntil: string | null;
  /** Pausas passadas e a atual, [início, fim] inclusive — dias neutros na força. */
  pauses: [string, string][];
  archived: boolean;
  /** Primeiro dia que conta (yyyy-MM-dd). */
  createdDay: string;
}

/** Para criar: só o título é obrigatório. */
export type HabitInput = Partial<Omit<HabitDef, 'id' | 'type' | 'createdDay' | 'pauses'>> & { title: string };

export interface HabitStats {
  type: string;
  /** Força do hábito, 0..1 (média exponencial à moda do Loop Habit Tracker). */
  strength: number;
  stage: HabitStage;
  formed: boolean;
  /** Nos últimos 30 dias (sem hoje, se pendente): dias feitos / dias que contavam. */
  last30: { done: number; total: number };
  /** Dias feitos na sequência atual sem DUAS faltas seguidas ("nunca falhe duas vezes"). */
  streak: number;
  best: number;
  /** Total de dias feitos desde sempre (os marcos: 7, 21, 30, 66, 100, 200, 365). */
  total: number;
  /** HEAT_DAYS caracteres (ver HEAT_CHAR); o último é hoje. */
  heat: string;
  /** HEAT_DAYS valores 0..1 da força ao fim de cada dia; o último é hoje. */
  series: number[];
  /** Última média do SRBAI (1..7), e quando. */
  srbai: number | null;
  srbaiAt: string | null;
  /** Hora de responder as 4 perguntas de automaticidade. */
  srbaiDue: boolean;
  /** Em 'semana': vezes feitas na semana corrente. */
  weekDone: number | null;
  /** Ontem era dia do hábito e não foi feito (hoje é dia de VOLTAR). */
  missedYesterday: boolean;
  today: HabitDayStatus;
  todayValue: number | null;
  /** Num hábito de parar: dias seguidos sem deslize registrado (até ontem, mais hoje se limpo). */
  cleanDays: number | null;
}

export interface TodayHabit {
  habit: HabitDef;
  stats: HabitStats;
  period: HabitPeriod;
  /** Em 'semana', a cota da semana já foi cumprida (mostra recolhido). */
  doneForWeek: boolean;
}

export interface HabitSlip {
  id: number;
  key: string;
  /** ISO do momento. */
  at: string;
  place: string | null;
  emotion: string | null;
  trigger: string | null;
  note: string | null;
  /** true = vontade SUPERADA (surfou a vontade, sem deslize). */
  resisted: boolean;
}

export interface SrbaiEntry {
  key: string;
  date: string;
  /** As 4 respostas, 1..7. */
  items: number[];
  mean: number;
}

/** O que aconteceu ao marcar — a tela comemora. */
export interface MarkResult {
  /** Marco de dias feitos atingido agora (7, 21, 30, 66, 100, 200, 365), ou null. */
  milestone: number | null;
  /** Todos os hábitos de hoje resolvidos como feitos. */
  perfectDay: boolean;
  /** Feito depois de uma falta ontem: "voltou — é isso que forma hábito". */
  comeback: boolean;
}

export interface WeekHabitSummary {
  habit: HabitDef;
  done: number;
  expected: number;
  strengthStart: number;
  strengthEnd: number;
  reasons: { date: string; status: string; reason: string }[];
  slips: number;
  resisted: number;
}

export interface WeekSummary {
  /** Segunda-feira da semana (yyyy-MM-dd). */
  weekStart: string;
  weekEnd: string;
  habits: WeekHabitSummary[];
}
