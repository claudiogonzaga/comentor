import * as Notifications from 'expo-notifications';
import { getUserConfig } from './database';
import { ensureChannel } from './notifications';
import { getOwlSpecies } from '../constants/owlSpecies';
import { syncSpokenInspirations } from './spokenNudges';

/**
 * Modo "inspiração": quando ligado, a Comentora dispara um alerta a cada hora
 * cheia dentro de uma janela diurna, com mensagens curtas de otimismo,
 * persistência e inspiração. São lembretes locais DIÁRIOS (um por hora), então
 * funcionam mesmo com o app fechado, e se repetem todo dia até o usuário
 * desligar o modo.
 *
 * Por que uma janela diurna e não 24h: alertas de madrugada brigariam com o
 * propósito do app (ajudar a dormir). A janela vai de INSPIRATION_START_HOUR
 * até INSPIRATION_END_HOUR (inclusive).
 */
const INSPIRATION_START_HOUR = 8;
const INSPIRATION_END_HOUR = 21;

/** data.type das notificações deste modo — usado para cancelar só elas. */
const INSPIRATION_TYPE = 'inspiration';

interface InspirationMessage {
  title: string;
  body: string;
}

/**
 * Banco de mensagens. Mantém variedade suficiente para cada hora da janela
 * receber uma mensagem distinta (a janela tem ~14 horários). Embaralhado a
 * cada reagendamento, então a ordem muda de tempos em tempos.
 */
const INSPIRATION_MESSAGES: InspirationMessage[] = [
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

function shuffled<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Cancela apenas as notificações do modo inspiração. */
export async function cancelInspirationNotifications(): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  for (const s of scheduled) {
    const data = s.content.data as { type?: string };
    if (data?.type === INSPIRATION_TYPE) {
      await Notifications.cancelScheduledNotificationAsync(s.identifier);
    }
  }
}

/**
 * Reagenda o modo inspiração. Se o modo estiver desligado, apenas cancela.
 * Se ligado, agenda um alerta DIÁRIO em cada hora cheia da janela diurna,
 * cada um com uma mensagem distinta (embaralhada). Idempotente — seguro
 * chamar a cada save / ao abrir o app.
 */
export async function scheduleInspirationNotifications(): Promise<void> {
  await cancelInspirationNotifications();

  let enabled = false;
  let sound: string = 'default';
  let perDay = 6;
  try {
    const config = await getUserConfig();
    enabled = !!config.inspirationModeEnabled;
    sound = getOwlSpecies(config.owlSpecies).soundFile ?? 'default';
    perDay = config.inspirationPerDay ?? 6;
  } catch {
    /* sem config legível → trata como desligado */
  }
  if (!enabled) {
    // limpa também os alarmes FALADOS de inspiração (se houver)
    void syncSpokenInspirations([]).catch(() => {});
    return;
  }

  const channelId = await ensureChannel();
  const messages = shuffled(INSPIRATION_MESSAGES);
  // coletados para, ao final, agendar as versões FALADAS (se o recurso estiver on)
  const spokenItems: { text: string; hour: number; minute: number }[] = [];

  // Espalha `perDay` mensagens na janela diurna [START, END]. Antes era uma
  // por hora fixa; agora o usuário escolhe quantas quer.
  const n = Math.max(1, Math.min(14, Math.round(perDay)));
  const startMin = INSPIRATION_START_HOUR * 60;
  const endMin = INSPIRATION_END_HOUR * 60;
  const span = endMin - startMin;

  for (let i = 0; i < n; i++) {
    const t =
      n === 1 ? Math.round(startMin + span / 2) : Math.round(startMin + (span * i) / (n - 1));
    const hour = Math.floor(t / 60);
    const minute = t % 60;
    const msg = messages[i % messages.length];
    // a versão falada lê só o corpo (o título tem emoji decorativo)
    spokenItems.push({ text: msg.body, hour, minute });
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: msg.title,
          body: msg.body,
          data: { type: INSPIRATION_TYPE, hour },
          sound,
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DAILY,
          hour,
          minute,
          channelId,
        },
      });
    } catch (err) {
      console.warn(`failed to schedule inspiration alert @${hour}:${minute}:`, err);
    }
  }

  // Agenda as versões FALADAS em background (pré-renderiza a voz Gemini e arma
  // os alarmes nativos). Best-effort e fora do caminho crítico do agendamento.
  void syncSpokenInspirations(spokenItems).catch(() => {});
}
