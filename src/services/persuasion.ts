// Mensagens PERSUASIVAS das insistências repetidas. A cada repetição (k) a
// coruja muda o argumento e vai ficando mais convincente — usando técnicas
// sutis de persuasão em vez de repetir a mesma frase:
//   compromisso/consistência · passo pequeno · eu-futuro · aversão à perda ·
//   identidade · prova social leve · reenquadre do esforço · apelo direto.
// Ordenadas por intensidade crescente; ciclam por k para nunca repetir a
// vizinha e voltar a escalar em chains longas.

type Line = (name: string) => string;

const LINES: Line[] = [
  // 1 — lembrete gentil
  (n) => `“${n}” ainda está te esperando.`,
  // 2 — compromisso/consistência
  (n) => `Você colocou “${n}” na sua rotina por um bom motivo — vale honrar isso agora.`,
  // 3 — passo pequeno (reduz a barreira)
  (n) => `É rapidinho: “${n}” leva menos tempo do que parece.`,
  // 4 — eu-futuro
  (n) => `Seu eu de amanhã vai agradecer por você ter feito “${n}” hoje.`,
  // 5 — aversão à perda
  (n) => `Não deixe o dia passar em branco — “${n}” ainda dá tempo.`,
  // 6 — identidade
  (n) => `Quem cuida de si não pula “${n}”. E você é dessas pessoas.`,
  // 7 — prova social leve + consistência
  (n) => `Você vem indo tão bem… não quebra o ritmo bem no “${n}”.`,
  // 8 — reenquadre do esforço (alívio pós-tarefa)
  (n) => `Depois de feito, “${n}” sai da sua cabeça e você relaxa.`,
  // 9 — apelo direto e afetuoso
  (n) => `Vou insistir com carinho 🙏 — “${n}” continua te chamando. Me responde?`,
  // 10 — firme, mas gentil
  (n) => `Última cobrança por agora: “${n}” merece um minutinho seu.`,
];

/**
 * Corpo da k-ésima insistência (k = 1, 2, 3…): um argumento persuasivo DIFERENTE
 * a cada vez, seguido da instrução do botão (`actionLine`).
 */
export function persuasiveBody(name: string, actionLine: string, k: number): string {
  const idx = Math.max(0, k - 1) % LINES.length;
  return `${LINES[idx](name)} ${actionLine}`;
}
