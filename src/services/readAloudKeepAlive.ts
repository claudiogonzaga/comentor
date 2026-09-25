// Mantém o app VIVO enquanto o áudio do "Leia para mim" é GERADO.
//
// Problema: a geração é um loop de REDE em JS. Ao sair do app, o Android congela
// o JS depois de um tempo (Doze / app em cache) e a geração para no meio. A
// REPRODUÇÃO sobrevive porque o expo-audio mantém um foreground service de mídia
// — mas durante a GERAÇÃO não há áudio tocando, então nada segura o processo.
//
// Tentativa (v1.52.0): tocar um loop SILENCIOSO (volume 0) só durante a geração,
// supondo que isso ligasse o foreground service de mídia e mantivesse o JS
// rodando.
//
// NÃO FUNCIONA — verificado no aparelho em 2026-09-25: (1) o expo-audio só cria
// o serviço em primeiro plano via setActiveForLockScreen, que o app não chama —
// `dumpsys activity services` não mostra serviço nenhum durante a geração; (2)
// mesmo com serviço, no React Native (nova arquitetura) os timers ficam parados
// com a Activity pausada, e o fetch (whatwg-fetch) só entrega a resposta dentro
// de um setTimeout. Resultado: fora do app, a geração congela.
//
// O que segura a geração hoje é a TELA ACESA (expo-keep-awake, em
// useReadAloud) + trechos persistidos em disco (retomável). Este loop foi
// mantido por ser inofensivo; gerar de fato com o app fora da tela exigiria uma
// tarefa Headless JS em serviço de primeiro plano.

import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { File, Paths } from 'expo-file-system';

let player: AudioPlayer | null = null;

/** Cria (uma vez) e devolve o uri de um WAV de 1s de silêncio. */
function ensureSilenceUri(): string {
  const f = new File(Paths.cache, 'readaloud_keepalive_silence.wav');
  if (f.exists) return f.uri;
  const SR = 8000;
  const CH = 1;
  const BPS = 16;
  const dataLen = SR * CH * (BPS / 8); // 1 segundo
  const buf = new Uint8Array(44 + dataLen); // tudo zero = silêncio
  const dv = new DataView(buf.buffer);
  let o = 0;
  const wStr = (s: string) => {
    for (let i = 0; i < s.length; i++) buf[o++] = s.charCodeAt(i);
  };
  const wU32 = (v: number) => {
    dv.setUint32(o, v, true);
    o += 4;
  };
  const wU16 = (v: number) => {
    dv.setUint16(o, v, true);
    o += 2;
  };
  wStr('RIFF');
  wU32(36 + dataLen);
  wStr('WAVE');
  wStr('fmt ');
  wU32(16);
  wU16(1); // PCM
  wU16(CH);
  wU32(SR);
  wU32(SR * CH * (BPS / 8));
  wU16(CH * (BPS / 8));
  wU16(BPS);
  wStr('data');
  wU32(dataLen);
  try {
    f.create({ overwrite: true });
    f.write(buf);
  } catch {
    /* ignore */
  }
  return f.uri;
}

/** Liga o keep-alive (loop silencioso) — chame ao COMEÇAR a geração. */
export async function startReadAloudKeepAlive(): Promise<void> {
  try {
    if (player) return;
    // mixWithOthers + volume 0: não duca nem atrapalha música/podcast do usuário.
    await setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'mixWithOthers',
    });
    const p = createAudioPlayer({ uri: ensureSilenceUri() });
    p.loop = true;
    p.volume = 0;
    player = p;
    p.play();
  } catch {
    /* best-effort — se falhar, a geração ainda funciona em primeiro plano */
  }
}

/** Desliga o keep-alive — chame ao TERMINAR/parar a geração. */
export function stopReadAloudKeepAlive(): void {
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
