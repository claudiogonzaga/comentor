// Frases padrão da Comentora (motivacionais curtas). Ficavam embutidas no
// inspiration.ts; foram extraídas para cá para servir de SEED do pack embutido
// "Frases da Comentora" na biblioteca de inspiração (database.ts) sem criar
// ciclo de import (constantes não importam serviços).

export interface ComentoraMessage {
  title: string;
  body: string;
}

export const COMENTORA_MESSAGES: ComentoraMessage[] = [
  { title: '🌅 Comece de novo', body: 'Todo instante é uma chance de recomeçar. Respira fundo e segue.' },
  { title: '🦉 Persistência', body: 'Não precisa ser rápido. Só precisa não parar.' },
  { title: '✨ Você consegue', body: 'O que parecia impossível ontem é o seu normal de amanhã.' },
  { title: '🌱 Pequenos passos', body: 'Um passo pequeno hoje vale mais que um salto perfeito que nunca acontece.' },
  { title: '💪 Força', body: 'A dificuldade de agora está te preparando para a força de depois.' },
  { title: '🌞 Otimismo', body: 'Mesmo nos dias nublados, o sol continua lá. E você também.' },
  { title: '🎯 Foco', body: 'Você não precisa ver a escada inteira. Só o próximo degrau.' },
  { title: '🌊 Constância', body: 'A gota constante fura a pedra — não pela força, mas pela insistência.' },
  { title: '🔥 Coragem', body: 'Coragem não é não ter medo. É seguir mesmo com ele.' },
  { title: '🍃 Respira', body: 'Você está fazendo melhor do que pensa. Vai com calma e gentileza.' },
  { title: '🌟 Acredite', body: 'Acreditar em você mesmo é o primeiro passo de toda conquista.' },
  { title: '🧭 Direção', body: 'Não importa a velocidade — importa estar indo na direção certa.' },
  { title: '🌈 Esperança', body: 'Depois de cada tempestade, você fica um pouco mais forte e mais sábio.' },
  { title: '⛰️ Resiliência', body: 'Cair faz parte. Levantar é o que te define.' },
  { title: '💫 Progresso', body: 'Compare-se com quem você era ontem, não com mais ninguém.' },
  { title: '🌻 Gratidão', body: 'Encontre uma coisa boa em agora. Sempre tem uma.' },
  { title: '🚀 Movimento', body: 'Feito é melhor que perfeito. Dá o primeiro passo agora.' },
  { title: '🦋 Transformação', body: 'Toda mudança grande começa com uma pequena decisão repetida.' },
  { title: '🌙 Paciência', body: 'As coisas boas levam tempo. Confie no seu processo.' },
  { title: '💛 Autocuidado', body: 'Cuidar de você não é egoísmo — é o que te permite seguir em frente.' },
  { title: '🌳 Raízes', body: 'Plante hoje a constância que vai te dar sombra amanhã.' },
  { title: '⭐ Você importa', body: 'O mundo é um pouco melhor porque você está nele. Continue.' },
  { title: '🎈 Leveza', body: 'Nem tudo precisa ser resolvido hoje. Solta o peso que não é seu.' },
  { title: '🏔️ Determinação', body: 'A montanha se sobe olhando para o próximo passo, não para o topo.' },
  { title: '🫀 Zona 2', body: 'Mire 150–200+ min de zona 2 por semana, em 3–4 sessões de 45–60 min. Ritmo leve e contínuo — dá pra conversar, mas não cantar. Sessões muito curtas rendem pouco: a adaptação das mitocôndrias pede constância e duração.' },
];

/** Nomes dos packs embutidos (usados no seed e no restaurar-padrão). */
export const PACK_COMENTORA = 'Frases da Comentora';
export const PACK_CITACOES = 'Citações e fatos inspiradores';
