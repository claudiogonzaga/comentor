// A corrente da noite. São até 12 avisos, cada um com um argumento diferente:
// antes eram 5 textos, e do 5º em diante todos diziam "Última mensagem de hoje".

export interface NightLine {
  title: string;
  body: string;
}

const LINES: NightLine[] = [
  { title: '🦉 Hora da cama', body: 'Deu o horário que você escolheu. A manhã de amanhã começa agora.' },
  { title: '🦉 Só o primeiro passo', body: 'Não precisa dormir já. Larga a tela e vai escovar os dentes: o resto vem.' },
  { title: '🦉 Amanhã agradece', body: 'O você de amanhã cedo vai acordar com o que você decidir nos próximos minutos.' },
  { title: '🦉 Melhor que café', body: 'Uma noite inteira de sono faz pelo foco de amanhã o que nenhum café consegue.' },
  { title: '🦉 Pergunta sincera', body: 'O que você está fazendo agora vale mais do que a sua manhã de amanhã?' },
  { title: '🦉 Fecha o dia', body: 'O que ficou pendente cabe na lista de amanhã. Anota e solta.' },
  { title: '🦉 Deixa o cérebro trabalhar', body: 'O que você aprendeu hoje se fixa enquanto você dorme. Dá esse tempo para ele.' },
  { title: '🦉 Você sabe como é', body: 'Lembra da última manhã em que acordou descansado? Ela começou numa noite como esta.' },
  { title: '🦉 Sem sermão', body: 'Só um convite: luz apagada, celular longe e três respirações longas.' },
  { title: '🦉 Ainda dá', body: 'Não é tarde para salvar parte da noite. Cada minuto de cama agora conta amanhã.' },
  { title: '🦉 Ainda por aí?', body: 'Tudo bem. Não precisa ser perfeito: indo agora, a noite ainda vale a pena.' },
];

const LAST: NightLine = {
  title: '🦉 Boa noite',
  body: 'Por hoje eu paro de chamar. Amanhã é outra chance, e ela começa bem se você dormir logo.',
};

/** O texto do aviso `i` de uma corrente de `total`: só o último se despede. */
export function nightLine(i: number, total: number): NightLine {
  if (total > 1 && i >= total - 1) return LAST;
  return LINES[i % LINES.length];
}
