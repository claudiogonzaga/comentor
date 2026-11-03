// Mensagens PERSUASIVAS das insistências repetidas. A cada repetição (k) a
// coruja muda o argumento e vai ficando mais convincente — usando técnicas
// sutis de persuasão em vez de repetir a mesma frase:
//   compromisso/consistência · passo pequeno · eu-futuro · aversão à perda ·
//   identidade · prova social leve · reenquadre do esforço · apelo direto.
// Ordenadas por intensidade crescente; ciclam por k para nunca repetir a
// vizinha e voltar a escalar em chains longas.

/**
 * Frases FIXAS, rotuladas pela técnica que usam. São o fallback de
 * insistenceLines.ts (quando não há modelo, rede ou chave) e a base do
 * persuasiveBody. O rótulo alimenta technique_stats do mesmo jeito que as
 * linhas geradas — assim o aprendizado sobre o que convence a pessoa não se
 * perde quando ela está offline.
 */
export interface FallbackLine {
  technique: string;
  line: (name: string, userName?: string | null) => string;
}

export const FALLBACK_LINES: FallbackLine[] = [
  // 1 — pergunta pessoal, com o nome
  {
    technique: 'pergunta-pessoal',
    line: (n, u) => `${u?.trim() ? `${u.trim()}, ` : ''}“${n}” já foi? Me diz: já fez ou precisa de mais tempo.`,
  },
  // 2 — compromisso/consistência
  { technique: 'compromisso', line: (n) => `Você escolheu “${n}” por um motivo. Esse motivo continua valendo agora.` },
  // 3 — passo pequeno (reduz a barreira)
  { technique: 'passo-pequeno', line: (n) => `Só o primeiro passo de “${n}”. Começar é a parte difícil, e cabe em dois minutos.` },
  // 4 — muda o registro: pergunta curta
  { technique: 'curto-e-seco', line: (n) => `E “${n}”, foi?` },
  // 5 — eu-futuro, curto
  { technique: 'eu-futuro', line: (n) => `Daqui a uma hora você vai gostar de ter feito “${n}”.` },
  // 6 — aversão à perda
  { technique: 'aversao-perda', line: (n) => `Ainda dá para salvar “${n}” hoje. Mais tarde, talvez não.` },
  // 7 — identidade
  { technique: 'identidade', line: (n) => `Cada vez que você faz “${n}”, vota em quem quer ser. Hoje ainda tem voto.` },
  // 8 — ritmo/consistência
  { technique: 'ritmo', line: (n) => `O que muda a vida é repetir, não o dia perfeito. “${n}”, nem que seja a versão curta.` },
  // 9 — reenquadre do esforço (alívio pós-tarefa)
  { technique: 'alivio', line: (n) => `Feito “${n}”, isso sai da sua cabeça. Vale o alívio.` },
  // 10 — apelo direto e afetuoso
  { technique: 'humor', line: (n) => `Sou uma coruja teimosa: “${n}” fica na minha lista até você me responder.` },
];

/** Compatibilidade: as frases sem o rótulo. */
const LINES = FALLBACK_LINES.map((f) => (n: string) => f.line(n));

/**
 * Corpo da k-ésima insistência (k = 1, 2, 3…): um argumento persuasivo DIFERENTE
 * a cada vez, seguido da instrução do botão (`actionLine`).
 */
export function persuasiveBody(name: string, actionLine: string, k: number): string {
  const idx = Math.max(0, k - 1) % LINES.length;
  return `${LINES[idx](name)} ${actionLine}`;
}

export interface EscalationOpts {
  /** Nome do usuário (personaliza a 2ª cobrança). */
  userName?: string | null;
  /** Pergunta direta sobre a ação, ex.: 'você já tomou as vitaminas?' */
  question: string;
  /** k-ésima insistência (1 = primeira cobrança após o aviso inicial). */
  k: number;
}

/**
 * ESCALADA da cobrança (muda o texto a cada repetição):
 *  aviso inicial (k=0, fora daqui) — direto: "Hora de tomar vitaminas";
 *  k=1 — pergunta pessoal: "Helena, você já tomou as vitaminas? Me diz: já fez ou
 *        precisa de mais tempo.";
 *  k=2 — procura o que travou: "Travou em alguma coisa? Você já tomou as vitaminas?";
 *  k≥3 — argumentos persuasivos variados (persuasiveBody).
 */
export function escalationBody(opts: EscalationOpts): string {
  const { userName, question, k } = opts;
  const q = question.trim();
  const qCap = q.charAt(0).toUpperCase() + q.slice(1);
  if (k <= 1) {
    const prefix = userName?.trim() ? `${userName.trim()}, ` : '';
    return `${prefix}${prefix ? q : qCap} Me diz: já fez ou precisa de mais tempo.`;
  }
  if (k === 2) {
    return `Travou em alguma coisa? ${qCap} Se o dia apertou, me diga, que eu ajusto.`;
  }
  return '';
}
