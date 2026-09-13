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
    line: (n, u) => `${u?.trim() ? `${u.trim()}, ` : ''}você já fez “${n}”? Marque aqui, por favor: já fez ou precisa de mais tempo.`,
  },
  // 2 — compromisso/consistência
  { technique: 'compromisso', line: (n) => `Você colocou “${n}” na sua rotina por um bom motivo — vale honrar isso agora.` },
  // 3 — passo pequeno (reduz a barreira)
  { technique: 'passo-pequeno', line: (n) => `É rapidinho: “${n}” leva menos tempo do que parece.` },
  // 4 — muda o registro: pergunta curta
  { technique: 'curto-e-seco', line: (n) => `E aí — “${n}” já foi?` },
  // 5 — eu-futuro, curto
  { technique: 'eu-futuro', line: (n) => `Seu eu de amanhã agradece por “${n}” hoje.` },
  // 6 — aversão à perda
  { technique: 'aversao-perda', line: (n) => `Não deixe o dia passar em branco — “${n}” ainda dá tempo.` },
  // 7 — identidade
  { technique: 'identidade', line: (n) => `Quem cuida de si não pula “${n}”. E você é dessas pessoas.` },
  // 8 — ritmo/consistência
  { technique: 'ritmo', line: (n) => `Você vem indo tão bem… não quebra o ritmo bem no “${n}”.` },
  // 9 — reenquadre do esforço (alívio pós-tarefa)
  { technique: 'alivio', line: (n) => `Depois de feito, “${n}” sai da sua cabeça e você relaxa.` },
  // 10 — apelo direto e afetuoso
  { technique: 'humor', line: (n) => `Vou insistir com carinho 🙏 — “${n}” continua te chamando. Me responde?` },
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
 *  k=1 — pergunta pessoal: "Helena, você já tomou as vitaminas? Marque aqui,
 *        por favor: já fez ou precisa de mais tempo.";
 *  k=2 — pede explicação: "Para evitar repetições desnecessárias, me diga o
 *        que aconteceu com este lembrete. Você já tomou as vitaminas?";
 *  k≥3 — argumentos persuasivos variados (persuasiveBody).
 */
export function escalationBody(opts: EscalationOpts): string {
  const { userName, question, k } = opts;
  const q = question.trim();
  const qCap = q.charAt(0).toUpperCase() + q.slice(1);
  if (k <= 1) {
    const prefix = userName?.trim() ? `${userName.trim()}, ` : '';
    return `${prefix}${prefix ? q : qCap} Marque aqui, por favor: já fez ou precisa de mais tempo.`;
  }
  if (k === 2) {
    return `Para evitar repetições desnecessárias, gostaria que me dissesse o que aconteceu com este lembrete. ${qCap}`;
  }
  return '';
}
