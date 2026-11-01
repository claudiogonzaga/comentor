import type { Period, Pillar } from '../types';

// Pilares default — copiados do config.yaml do Aspis desktop.
export const DEFAULT_PILLARS: Pillar[] = [
  {
    id: 'saude',
    nome: 'Saúde mental e física',
    descricao:
      'Saúde baseada em evidência: sono, treino de força, nutrição sustentável, ansiedade, foco.',
    quero: ['protocolos acionáveis', 'estudos', 'hábitos sustentáveis'],
    nao_quero: ['dietas milagrosas', 'biohacking sem evidência', 'fitspiration'],
    peso: 3,
    mocName: 'Saúde',
  },
  {
    id: 'investimento',
    nome: 'Decisões acertadas em investimento',
    descricao: 'Decisões de longo prazo, alocação, gestão de risco, sobriedade.',
    quero: ['frameworks', 'dados macro', 'análise sóbria'],
    nao_quero: ['pump de cripto', 'day-trade hype', 'FOMO', 'sinais de compra'],
    peso: 3,
    mocName: 'Investimento',
  },
  {
    id: 'paternidade',
    nome: 'Ser um bom pai',
    descricao:
      'Pai presente e melhor: desenvolvimento infantil, disciplina positiva, equilíbrio.',
    quero: ['psicologia do desenvolvimento', 'atividades', 'comunicação'],
    nao_quero: ['culpa parental', 'comparação', 'prescrições rígidas'],
    peso: 3,
    mocName: 'Paternidade',
  },
  {
    // Pilar amplo (igual ao desktop): conteúdo que ensina de verdade mas não cabe nos
    // outros pilares deixa de cair em "nenhum" com nota baixa.
    id: 'aprendizado',
    nome: 'Curiosidade e aprendizado',
    descricao:
      'Aprender algo de verdade fora dos outros pilares: ciência, história, tecnologia, ' +
      'como as coisas funcionam, ideias bem argumentadas.',
    quero: ['explicações claras', 'especialistas', 'conteúdo com fontes', 'ensaios bem argumentados'],
    nao_quero: ['listas de curiosidades rasas', 'react sem conteúdo', 'polêmica vazia'],
    peso: 2,
    mocName: 'Aprendizado',
  },
];

// Nome do MOC para vídeos sem pilar (obsidian.py: PILLAR_NAMES["nenhum"]).
export const MOC_NAME_NENHUM = 'Geral';

// Regras extras default da IA — iguais ao config.py do desktop (DEFAULT_RULES):
// descontos GRADUAIS (a embalagem não condena um conteúdo bom — dá para
// "resgatar") e opinião não é defeito por si só.
export const DEFAULT_RULES =
  'Sensacionalismo (rage bait, isca de engajamento, promessas vazias, FOMO, CAPS, ' +
  'emojis de alarme): marque is_clickbait e desconte aos poucos, conforme a ' +
  'intensidade (em geral 5 a 15 pontos). A embalagem não decide a nota: se o ' +
  'conteúdo entrega substância, a nota reflete a substância.\n' +
  'Priorize densidade de informação acionável e evidência sobre popularidade.\n' +
  'Opinião não é defeito: opinião qualificada (de quem entende do assunto, bem ' +
  'argumentada ou baseada em evidências) vale como conteúdo. Desconte só o achismo ' +
  'sem fundamento, e também aos poucos.\n' +
  "Entretenimento sem relação com os pilares vai para 'nenhum' com nota baixa, " +
  'mas sem zerar (em geral 10 a 20).';

// Regras default ANTERIORES (iguais ao desktop) — quem nunca as editou migra
// para as novas ao abrir o app.
export const LEGACY_DEFAULT_RULES =
  'Penalize sensacionalismo: rage bait, isca de engajamento, promessas vazias, ' +
  'FOMO, CAPS, emojis de alarme — marque is_clickbait e reduza o score.\n' +
  'Priorize densidade de informação acionável e evidência sobre popularidade.\n' +
  'Vídeos de pura opinião/entretenimento, sem valor para os objetivos, vão para ' +
  "'nenhum' com score baixo.";

// Score (0–100) → nível de alinhamento Likert (0–4). Limiares simétricos
// (passo de 25), com o centro (nível 2) = score ≥ 50.
export const STAR_MIN_SCORE: Record<number, number> = { 0: 0, 1: 25, 2: 50, 3: 75, 4: 90 };

export function scoreToStars(score: number): number {
  const s = Math.max(0, Math.min(100, Math.round(score || 0)));
  let stars = 0;
  for (const k of [1, 2, 3, 4]) {
    if (s >= STAR_MIN_SCORE[k]) stars = k;
  }
  return stars;
}

export function starsToThreshold(stars: number): number {
  return STAR_MIN_SCORE[Math.max(0, Math.min(4, stars))];
}

// Período de exibição/busca → horas de lookback (config.py: PERIODS).
export const PERIODS: Record<Period, number> = { day: 36, week: 24 * 7, month: 24 * 30 };
export const PERIOD_LABELS: Record<Period, string> = { day: 'Dia', week: 'Semana', month: 'Mês' };

// LLM — mesmos parâmetros do desktop (brain.py / config.yaml).
export const DEFAULT_MODEL = 'gemini-3.5-flash';
export const MODEL_PRESETS = ['gemini-3.5-flash', 'gemini-2.5-flash', 'gemini-2.5-pro'];
export const TEMPERATURE = 0.3;
export const MAX_OUTPUT_TOKENS = 4096;
export const MAX_TRANSCRIPT_CHARS = 14000;
export const ASK_MAX_TOKENS = 1200;
export const ASK_TRANSCRIPT_CHARS = 24000;
export const FACTCHECK_MAX_TOKENS = 2200; // checagem externa + aprofundamento
export const FLASHCARD_MAX_TOKENS = 1500; // extração de cartões de uma resposta

// Pipeline do feed.
export const MAX_VIDEOS_PER_CHANNEL = 8; // config.yaml: max_videos_per_channel
export const MAX_VIDEOS_PER_RUN = 40; // limite por execução (botão Atualizar)
export const MAX_LOOKBACK_HOURS = 24 * 30; // busca cobre o tempo sem abrir o app, até 1 mês
export const AUTO_REFRESH_AFTER_MS = 2 * 3600 * 1000; // abre o app → busca se a última foi há 2h+

// Defaults de exibição. Alinhamento mínimo = nível 1 (25%): o feed mostra
// bastante e a régua aperta se o usuário quiser — começar no centro (50%)
// combinado com o período "Dia" deixava o feed quase vazio.
export const DEFAULT_MIN_STARS = 1;
export const DEFAULT_PERIOD: Period = 'week';
