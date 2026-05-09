import type { IntensityLevel, Tone } from '../types';

type Bank = Record<IntensityLevel, Record<Tone, string[]>>;

export const SLEEP_FALLBACKS: Bank = {
  1: {
    gentle: [
      'Ei, deu o horário. Sua cama está te chamando — sem pressa, mas com carinho.',
      'Você sabia que durante o sono profundo seu cérebro literalmente lava as toxinas do dia? Que tal dar esse presente pra ele?',
      'Hora de desacelerar. Apaga uma luz, respira fundo. A noite está pronta pra você.',
    ],
    firm: [
      'São {bedtime}. Você se comprometeu com esse horário porque ele importa pra você.',
      'Cada minuto agora vale o dobro amanhã. Vamos fechar a noite com sabedoria.',
      'O futuro de você de amanhã está te observando. Faz o que precisa ser feito.',
    ],
    brutal: [
      'Hora marcada. Sem desculpa, sem "só mais cinco minutos". Cama. Agora.',
      'Você decidiu dormir às {bedtime}. Decidir é fácil; cumprir é o que diferencia gente.',
      'Tic tac. Cada minuto atrasado é um pedaço da sua manhã sendo roubado.',
    ],
  },
  2: {
    gentle: [
      'Faz {minutesLate} minutos do seu horário. Que tal a gente combinar de fechar isso em mais 2 minutos?',
      'Sei que tem coisa interessante aí. Mas seu corpo não recupera o sono perdido — só o acumula.',
      'Pensa numa coisa: você se sente melhor depois de uma boa noite ou depois de scrollar? A resposta sempre é a mesma.',
    ],
    firm: [
      '{minutesLate} minutos atrasado. Estudo do Walker Lab: cada hora de sono perdida custa até 30% de performance cognitiva.',
      'O que você está fazendo agora vai estar lá amanhã. Seu sono perdido, não.',
      'Você jurou pra si mesmo que seria mais saudável. Esse tipo de coisa é decidida agora, não amanhã.',
    ],
    brutal: [
      '{minutesLate} minutos. Não é mais "pouco tempo". É descumprir o combinado consigo mesmo.',
      'Sabe o que é pior que dormir tarde? Saber que você sabia e ignorou. Para com isso.',
      'Cada minuto agora é um voto na pessoa que você NÃO quer ser. Reverte.',
    ],
  },
  3: {
    gentle: [
      'Tô preocupada de verdade. Faz {minutesLate} minutos. Seu corpo está te pedindo descanso — toca aqui pra gente conversar.',
      'Sei que parece bobo, mas dormir mal aumenta cortisol em até 40%. Isso é estresse direto na sua corrente sanguínea.',
      'Olha pra mim: você merece o descanso. Não é luxo — é manutenção.',
    ],
    firm: [
      'Seu risco de doenças cardiovasculares sobe a cada noite assim. Isso não é exagero — é Matthew Walker, "Why We Sleep".',
      'Você se chama de pessoa saudável? Pessoa saudável não negocia com o sono toda noite. Decida ser quem você diz que é.',
      '{minutesLate} minutos. Seu corpo entra em modo de alerta. Você quer cortisol bombeando enquanto deveria estar relaxando?',
    ],
    brutal: [
      'Para. Olha o relógio. Olha o que você prometeu. Não bate. Conserta.',
      'Cada vez que você faz isso, seu cérebro aprende: "minha palavra vale pouco". Isso contamina tudo na sua vida.',
      'Você está literalmente envelhecendo mais rápido por causa disso. Não é metáfora. É telomero encurtando.',
    ],
  },
  4: {
    gentle: [
      'Preciso que você pare e pense: o que está sendo tão importante que vale mais que sua saúde?',
      'Isso aqui virou um padrão? Vamos quebrar hoje. Decisão pequena, ganho enorme.',
      'Eu não estou aqui pra te julgar. Estou aqui pra te lembrar que você merece mais que isso.',
    ],
    firm: [
      'Qual versão de você acordou ontem? E qual vai acordar amanhã se você dormir agora? Diferentes pessoas, mesmo dia.',
      'Você está há {minutesLate} minutos atrasado. Isso não é "uma noite". É um padrão se formando.',
      'O que você está postergando não vai ficar mais fácil amanhã. Mas dormir, sim.',
    ],
    brutal: [
      'Honestidade brutal: você está se sabotando. Sabe disso. Eu sei disso. O que vai fazer agora?',
      'Cada minuto a mais é uma escolha ativa. Você está escolhendo isso. Quer continuar escolhendo?',
      'Sua streak está no jogo. Sua manhã está no jogo. Sua semana está no jogo. Vale a pena?',
    ],
  },
  5: {
    gentle: [
      'Última mensagem de hoje. Não vou mais insistir. Mas amanhã a gente conversa sobre isso, ok? Boa noite quando vier.',
      'Tudo bem. A gente recomeça amanhã. Mas lembra: cada noite assim é um voto. Em quem você quer ser?',
      'Eu fico aqui. Quando você decidir dormir, vou estar do seu lado. Sem cobrança, só presença.',
    ],
    firm: [
      'Eu já disse o que tinha pra dizer. A escolha é sua. Mas amanhã eu vou perguntar — e você vai precisar de uma resposta boa.',
      'Cada vez que você ignora isso, está dizendo que o presente vale mais que o futuro. A gente sabe que não é verdade.',
      'Não é briga. É lembrete. Você merece dormir. Tchau até amanhã — espero te encontrar descansado.',
    ],
    brutal: [
      'Acabou meu trabalho de hoje. Você sabe o que precisa fazer. Faz ou não faz. Mas amanhã não venha reclamar.',
      'Eu não vou mais insistir hoje. Mas grava isso: você teve a chance e escolheu não pegar. Isso é seu.',
      'Última. Não falo mais. Mas seu corpo vai falar amanhã, mais alto que eu. Boa sorte.',
    ],
  },
};

export function pickFallback(level: IntensityLevel, tone: Tone, vars: Record<string, string | number>) {
  const arr = SLEEP_FALLBACKS[level][tone];
  const choice = arr[Math.floor(Math.random() * arr.length)];
  return choice.replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? ''));
}
