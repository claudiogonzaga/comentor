import { create } from 'zustand';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { prepareReadAloudAudio, speakLongText, stopSpeaking } from '../services/voice';
import { startReadAloudKeepAlive, stopReadAloudKeepAlive } from '../services/readAloudKeepAlive';
import { registerPlayer, claimPlayback } from '../services/playerBus';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

export type ReadAloudStatus = 'idle' | 'generating' | 'playing' | 'paused';

export interface ReadAloudStartOpts {
  provider: 'system' | 'gemini';
  geminiVoiceName?: string;
  voiceId?: string | null;
  language?: string | null;
  paused?: boolean;
  rate?: number;
}

interface ReadAloudState {
  status: ReadAloudStatus;
  /** Progresso da geração do áudio Gemini (só na 1ª vez). */
  gen: { done: number; total: number } | null;
  currentTime: number;
  duration: number;
  /** Rótulo curto do que está tocando (1ª linha do texto). */
  title: string;
  /** Voz Gemini (tem arquivo → scrubber). Sistema = sem barra. */
  isGemini: boolean;
  error: string | null;
  /** Incrementa a cada término NATURAL (para encadear respiração, etc.). */
  finishedTick: number;

  startGemini: (text: string, title: string, opts: ReadAloudStartOpts) => Promise<void>;
  startSystem: (text: string, title: string, opts: ReadAloudStartOpts) => void;
  playSavedUri: (uri: string, title: string, rate: number) => Promise<void>;
  toggle: () => void;
  stop: () => void;
  /** Cancela SÓ a geração de áudio em andamento (o player não é afetado). */
  cancelGeneration: () => void;
  seek: (fraction: number) => void;
  /** Volta `seconds` no áudio (ex.: 30s). Não passa de 0. */
  skipBack: (seconds: number) => void;
  setRate: (rate: number) => void;
  clearError: () => void;
}

// Player e assinatura em nível de MÓDULO (não de componente): a leitura continua
// mesmo que o usuário saia da tela "Leia para mim".
let player: AudioPlayer | null = null;
let sub: { remove: () => void } | null = null;
// Token de geração/reprodução: cada start/stop o incrementa; trabalho de uma
// geração antiga (que ainda estava gerando) é descartado quando o token muda.
let token = 0;
// CANCELAMENTO REAL da geração anterior: sem isto, cada nova tentativa deixava
// um loop "zumbi" gerando os trechos antigos — os zumbis consumiam os slots de
// requisições/minuto e a cota da API, e a tentativa nova ficava presa no
// "Preparando o áudio… 0/N" esperando um slot que nunca sobrava.
let genAbort: AbortController | null = null;

// Player único: quando OUTRO player (ex.: Minha sequência) assume, este para —
// só o áudio/fala; a GERAÇÃO em segundo plano continua intacta.
registerPlayer('readaloud', () => {
  try {
    void stopSpeaking();
  } catch {
    /* ignore */
  }
  teardownPlayer();
  useReadAloud.setState({ status: 'idle', currentTime: 0, duration: 0, title: '' });
});

// Identidade da geração em andamento (texto + voz + pausas). Um segundo toque
// no MESMO texto não aborta e recomeça — antes, cada toque impaciente jogava
// fora os trechos já gerados e gastava a cota de novo.
let genKey: string | null = null;
// Quem vai OUVIR o resultado da geração em andamento: o token de reprodução e a
// velocidade do pedido mais recente para este texto. Um novo toque no mesmo
// texto não reinicia a geração — ele a ASSUME (novo token), para que o áudio
// toque quando ficar pronto mesmo que outro áudio tenha tocado no meio.
let genOwner: { token: number; rate: number; title: string } | null = null;

function keyFor(text: string, opts: ReadAloudStartOpts): string {
  return `${opts.geminiVoiceName ?? ''}|${opts.paused ? 1 : 0}|${text}`;
}

/** Já existe uma geração em andamento para exatamente este texto/voz/pausas? */
export function isGeneratingSame(text: string, opts: ReadAloudStartOpts): boolean {
  return !!genAbort && genKey === keyFor(text.trim(), opts);
}

// TELA ACESA durante a geração. A geração é JS; no React Native (nova
// arquitetura) os timers — e com eles a entrega das respostas do fetch — ficam
// PARADOS enquanto o app está fora do primeiro plano. Se a tela apaga no meio,
// a geração congela até o app voltar. Manter a tela acesa restaura o "aperta e
// espera com o app aberto", que funcionava enquanto a geração era rápida.
const KEEP_AWAKE_TAG = 'readaloud-gen';

/** Tela acesa para outra geração (ex.: "Salvar e gerar áudio"), com tag própria. */
export function keepScreenOnFor(tag: string, on: boolean): void {
  if (on) void activateKeepAwakeAsync(tag).catch(() => {});
  else void deactivateKeepAwake(tag).catch(() => {});
}

function screenOnWhileGenerating(on: boolean): void {
  if (on) void activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
  else void deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
}

/** Encerra os recursos da geração — só se nenhuma geração mais nova assumiu. */
function releaseGenerationResources(): void {
  if (genAbort) return; // outra geração em andamento: ela é dona dos recursos
  genKey = null;
  stopReadAloudKeepAlive();
  screenOnWhileGenerating(false);
}

function abortOngoingGeneration(): void {
  try {
    genAbort?.abort();
  } catch {
    /* ignore */
  }
  genAbort = null;
  genKey = null;
  genOwner = null;
}

function teardownPlayer() {
  try {
    sub?.remove();
  } catch {
    /* ignore */
  }
  sub = null;
  // PAUSAR antes de remover: no expo-audio, `remove()` libera o objeto mas NÃO
  // garante que o som pare na hora — sem o pause, tocar outro arquivo deixava os
  // dois soando juntos e o botão ■ "não parava" nada. Pausa silencia já.
  try {
    player?.pause();
  } catch {
    /* ignore */
  }
  try {
    player?.remove();
  } catch {
    /* ignore */
  }
  player = null;
}

function formatErr(e: unknown): string {
  const daily = !!(e as { dailyQuota?: boolean })?.dailyQuota;
  if (daily) {
    return 'cota DIÁRIA da API esgotada (≈100 leituras/dia). Reseta à meia-noite no Pacífico (~4-5h no Brasil). Tente a voz do sistema em “Sons e Vozes”.';
  }
  const raw = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
  const low = raw.toLowerCase();
  if (low.includes('429') || low.includes('quota') || low.includes('rate')) {
    return 'limite POR MINUTO da API atingido — aguarde um pouquinho e tente de novo.';
  }
  if (low.includes('chave') || low.includes('api key') || low.includes('api_key')) {
    return 'problema com a chave da API.';
  }
  return raw || 'não consegui gerar o áudio.';
}

export const useReadAloud = create<ReadAloudState>((set, get) => {
  const attachAndPlay = async (uri: string, rate: number, mine: number) => {
    claimPlayback('readaloud'); // para a Sequência (ou outros) antes de tocar
    // Modo de áudio da REPRODUÇÃO: toca em background + duca outras mídias.
    // Setado DIRETO (não pelo ensureBackgroundAudio guardado) para sempre
    // sobrescrever o 'mixWithOthers' que o keep-alive da geração deixou.
    try {
      await setAudioModeAsync({
        playsInSilentMode: true,
        shouldPlayInBackground: true,
        interruptionMode: 'duckOthers',
      });
    } catch {
      /* segue tocando em primeiro plano se falhar */
    }
    if (mine !== token) return; // um start mais novo assumiu durante o await
    teardownPlayer();
    const p = createAudioPlayer({ uri });
    player = p;
    try {
      p.loop = false; // NUNCA repetir ao chegar no fim (sem loop)
      p.shouldCorrectPitch = true;
      if (rate && Math.abs(rate - 1) > 0.001) p.setPlaybackRate(rate, 'high');
    } catch {
      /* nem todo device aplica rate */
    }
    sub = p.addListener('playbackStatusUpdate', (st) => {
      if (player !== p) return; // status de um player já substituído
      const cur = st?.currentTime ?? 0;
      const dur = st?.duration ?? 0;
      if (st?.didJustFinish) {
        // PAUSA antes de voltar pro início — senão o seekTo(0) reinicia a fala
        // (a intenção de tocar persiste) e vira LOOP infinito.
        try {
          p.pause();
        } catch {
          /* ignore */
        }
        try {
          p.seekTo(0);
        } catch {
          /* ignore */
        }
        set((s) => ({
          status: 'paused',
          currentTime: 0,
          duration: dur,
          finishedTick: s.finishedTick + 1,
        }));
        return;
      }
      set({ currentTime: cur, duration: dur, status: st?.playing ? 'playing' : 'paused' });
    });
    set({ currentTime: 0, status: 'playing' });
    try {
      p.play();
    } catch {
      /* ignore */
    }
  };

  return {
    status: 'idle',
    gen: null,
    currentTime: 0,
    duration: 0,
    title: '',
    isGemini: false,
    error: null,
    finishedTick: 0,

    // Voz GEMINI: gera o áudio COMPLETO (pode levar minutos) e toca. Roda em
    // nível de módulo → o usuário pode NAVEGAR para outras telas do app; a
    // leitura começa quando ficar pronta, em qualquer tela. SAIR do app (ou a
    // tela apagar) pausa a geração até o app voltar — por isso a tela fica
    // acesa, e os trechos prontos ficam em disco (retomável).
    startGemini: async (text, title, opts) => {
      const t = text.trim();
      if (!t) return;
      // Mesmo texto já sendo gerado: NÃO recomeça (jogaria fora os trechos e a
      // cota). Assume a geração: para o que estiver tocando e passa a ser o dono
      // do resultado — o áudio toca quando ficar pronto.
      if (genAbort && genKey === keyFor(t, opts) && genOwner) {
        const tk = ++token;
        genOwner.token = tk;
        genOwner.rate = opts.rate ?? 1;
        genOwner.title = title;
        await stopSpeaking();
        // Revalida depois do await: a geração pode ter TERMINADO (a conclusão
        // já está tocando o áudio com este token), FALHADO ou sido CANCELADA
        // nesse meio-tempo. Em qualquer desses casos, não mexe em nada — senão
        // mataria o áudio recém-iniciado ou prenderia a tela em "gerando".
        // A tela acesa não é reativada aqui: a geração em andamento já a segura.
        if (tk !== token || !genAbort || genOwner?.token !== tk) return;
        teardownPlayer();
        set({ status: 'generating', isGemini: true, title, currentTime: 0, duration: 0, error: null });
        return;
      }
      const mine = ++token;
      abortOngoingGeneration(); // uma geração por vez (a nova substitui a antiga)
      const myAbort = new AbortController();
      genAbort = myAbort;
      genKey = keyFor(t, opts);
      const me = { token: mine, rate: opts.rate ?? 1, title };
      genOwner = me;
      const signal = myAbort.signal;
      await stopSpeaking();
      teardownPlayer();
      set({
        status: 'generating',
        isGemini: true,
        title,
        gen: { done: 0, total: 1 },
        currentTime: 0,
        duration: 0,
        error: null,
      });
      // Tela acesa enquanto gera (ver screenOnWhileGenerating). O loop
      // silencioso abaixo é antigo e NÃO segura a geração fora do app: ele não
      // cria serviço em primeiro plano nem destrava os timers do JS.
      screenOnWhileGenerating(true);
      void startReadAloudKeepAlive();
      try {
        const uri = await prepareReadAloudAudio(t, {
          geminiVoiceName: opts.geminiVoiceName,
          paused: opts.paused,
          signal,
          // Progresso segue a GERAÇÃO (myAbort), não o player: tocar outro
          // arquivo no meio não apaga nem interrompe o andamento.
          onProgress: (done, total) => {
            if (genAbort === myAbort) set({ gen: { done, total } });
          },
        });
        if (genAbort === myAbort) genAbort = null;
        // Só limpa o progresso/recursos se nenhuma geração mais nova assumiu.
        if (!genAbort) set({ gen: null });
        releaseGenerationResources();
        if (genOwner === me) genOwner = null;
        // Se o usuário tocou OUTRA coisa durante a geração, não rouba o player:
        // o áudio ficou no cache e toca na hora quando ele pedir esse texto.
        // `me.token` (e não o `mine` original): um toque repetido no mesmo
        // texto assumiu a geração com um token novo.
        if (me.token !== token) return;
        if (uri) await attachAndPlay(uri, me.rate, me.token);
        else set({ status: 'idle' });
      } catch (e) {
        if (genAbort === myAbort) genAbort = null;
        if (genOwner === me) genOwner = null;
        releaseGenerationResources();
        if ((e as { aborted?: boolean })?.aborted) {
          // cancelamento explícito — não é erro. Uma geração abortada por uma
          // NOVA não mexe no progresso da nova.
          if (me.token === token) set({ status: 'idle', gen: null });
          else if (!genAbort) set({ gen: null });
          return;
        }
        set((s2) => ({
          gen: null,
          // só derruba o status se ainda é a geração ativa (não o player de outro áudio)
          ...(me.token === token ? { status: 'idle' as const, error: formatErr(e) } : {}),
          finishedTick: s2.finishedTick,
        }));
      }
    },

    // Voz do SISTEMA: lê direto (expo-speech; também continua entre telas). Sem
    // arquivo/scrubber.
    startSystem: (text, title, opts) => {
      const t = text.trim();
      if (!t) return;
      const mine = ++token;
      claimPlayback('readaloud');
      stopSpeaking();
      teardownPlayer();
      set({
        status: 'playing',
        isGemini: false,
        title,
        gen: null,
        currentTime: 0,
        duration: 0,
        error: null,
      });
      speakLongText(t, {
        provider: 'system',
        voiceId: opts.voiceId,
        language: opts.language,
        rate: opts.rate,
        paused: opts.paused,
        onDone: () => {
          if (mine === token) set((s) => ({ status: 'idle', finishedTick: s.finishedTick + 1 }));
        },
        onError: () => {
          if (mine === token) set({ status: 'idle', error: 'não consegui ler o texto.' });
        },
      });
    },

    // Texto SALVO com áudio pronto → toca direto (instantâneo).
    playSavedUri: async (uri, title, rate) => {
      const mine = ++token;
      await stopSpeaking();
      teardownPlayer();
      if (mine !== token) return;
      set({
        status: 'generating',
        isGemini: true,
        title,
        gen: null,
        currentTime: 0,
        duration: 0,
        error: null,
      });
      await attachAndPlay(uri, rate, mine);
    },

    toggle: () => {
      const p = player;
      if (!p) return;
      try {
        if (get().status === 'playing') {
          p.pause();
          set({ status: 'paused' });
        } else {
          // Se está no fim, recomeça do início ao dar play (replay).
          const { currentTime, duration } = get();
          if (duration > 0 && currentTime >= duration - 0.25) {
            try {
              p.seekTo(0);
            } catch {
              /* ignore */
            }
          }
          p.play();
          set({ status: 'playing' });
        }
      } catch {
        /* ignore */
      }
    },

    stop: () => {
      token++;
      stopSpeaking();
      // keep-alive/tela acesa ficam se ainda há GERAÇÃO em andamento (o stop é do player).
      releaseGenerationResources();
      teardownPlayer();
      // NÃO zera `gen`: a geração em segundo plano segue (só o player para).
      set({ status: 'idle', currentTime: 0, duration: 0, title: '' });
    },

    // Cancela SÓ a geração (botão "Parar geração" do banner). Player intacto.
    cancelGeneration: () => {
      abortOngoingGeneration();
      releaseGenerationResources();
      set((s2) => ({
        gen: null,
        ...(s2.status === 'generating' ? { status: 'idle' as const } : {}),
      }));
    },

    // Arrastar a barra: pula no tempo SEM mudar play/pause (arrastar pausado
    // continua pausado).
    seek: (fraction) => {
      const p = player;
      const { duration } = get();
      if (!p || duration <= 0) return;
      try {
        p.seekTo(Math.max(0, Math.min(1, fraction)) * duration);
      } catch {
        /* ignore */
      }
    },

    skipBack: (seconds) => {
      const p = player;
      const { currentTime } = get();
      if (!p) return;
      try {
        const target = Math.max(0, currentTime - Math.abs(seconds));
        p.seekTo(target);
        set({ currentTime: target });
      } catch {
        /* ignore */
      }
    },

    setRate: (rate) => {
      const p = player;
      if (!p) return;
      try {
        p.shouldCorrectPitch = true;
        p.setPlaybackRate(rate && rate > 0 ? rate : 1, 'high');
      } catch {
        /* ignore */
      }
    },

    clearError: () => set({ error: null }),
  };
});
