// O estado do Zazen: preferências, a sessão em andamento e os minutos sentados
// por dia. Fica em app_kv, no banco da Noosfera (entra no backup).
//
// Os sinos são do motor nativo do Kinesis (modules/kinesis-timer), que toca com a
// tela apagada e o app fechado. O motor guarda UMA linha do tempo: quem arma por
// último manda. Por isso o Zazen pergunta antes de parar um timer do Kinesis e,
// se o Kinesis começar no meio de um zazen, cede sem brigar.

import { AppState } from 'react-native';
import { create } from 'zustand';

import KinesisTimer from '../../modules/kinesis-timer';
import { useKinesis } from '../kinesis/store';
import { getKV, setKV } from '../services/database';
import {
  chaveDoDia,
  faseEm,
  limitarMinutos,
  linhaDoTempo,
  minutosSentados,
  normalizarPrefs,
  planejarSessao,
  PREFS_PADRAO,
  somarAoDia,
  type ZazenPrefs,
  type ZazenSessao,
} from './sessao';

const KEYS = {
  prefs: 'zazen:prefs',
  sessao: 'zazen:sessao',
  dias: 'zazen:dias',
} as const;

/** Quanto tempo o "合掌 · gasshō" fica na tela depois do último sino. */
const GASSHO_MS = 7000;
/** Abrindo o app logo depois do fim (pela notificação), ainda vale o gasshō. */
const GASSHO_JANELA_MS = 60_000;

function save(key: string, value: unknown): void {
  void setKV(key, JSON.stringify(value)).catch((err) => console.warn('[zazen] não salvou', key, err));
}

async function read<T>(key: string): Promise<T | undefined> {
  try {
    const raw = await getKV(key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

function sessaoValida(s: ZazenSessao | null | undefined): s is ZazenSessao {
  return (
    !!s &&
    Number.isFinite(s.preparoEm) &&
    Number.isFinite(s.inicioEm) &&
    Number.isFinite(s.fimEm) &&
    s.fimEm > s.inicioEm &&
    Array.isArray(s.avisos)
  );
}

/** Entrega ao motor o futuro da sessão; sem sessão, cala tudo. */
function armar(sessao: ZazenSessao | null): void {
  try {
    if (!KinesisTimer) return;
    if (!sessao) {
      KinesisTimer.disarm();
      return;
    }
    KinesisTimer.arm(JSON.stringify(linhaDoTempo(sessao, Date.now())));
  } catch (err) {
    console.warn('[zazen] não armou a linha do tempo:', err);
  }
}

/** O timer do Kinesis está usando o motor (rodando ou em pausa)? */
export function kinesisRodando(): boolean {
  return !!useKinesis.getState().timer?.running;
}

interface ZazenStore {
  loaded: boolean;
  prefs: ZazenPrefs;
  sessao: ZazenSessao | null;
  /** Minutos sentados por dia (YYYY-MM-DD local). */
  dias: Record<string, number>;
  /** Até quando o "合掌 · gasshō" fica na tela (epoch ms); 0 = não está. */
  gasshoAte: number;

  load(): Promise<void>;
  /** Põe a sessão em dia com o relógio: no fim, soma os minutos e mostra o gasshō. */
  tick(): void;

  setMinutos(minutos: number): void;
  bumpMinutos(delta: number): void;
  patchPrefs(patch: Partial<ZazenPrefs>): void;
  /** Toca um som do Zazen agora (prévia), no volume do Kinesis. */
  preview(sound: string): void;

  /** Começa: preparação, shijōshō, avisos, hōzenshō. Quem chama já resolveu o conflito com o Kinesis. */
  start(): void;
  /** Encerrar antes: para tudo em silêncio, sem sino. */
  stop(): void;
  /** O motor foi calado por fora (o Kinesis parou): entrega de novo a sessão. */
  rearm(): void;
  /** O Kinesis tomou o motor: o zazen termina em silêncio, sem mexer no motor. */
  ceder(): void;
}

export const useZazen = create<ZazenStore>((set, get) => {
  /** Fecha a sessão: guarda os minutos sentados (no dia de `quando`) e tira a sessão do disco. */
  const encerrar = (minutos: number, quando: number) => {
    const dias = somarAoDia(get().dias, quando, minutos);
    set({ sessao: null, dias });
    save(KEYS.sessao, null);
    if (minutos > 0) save(KEYS.dias, dias);
  };

  return {
    loaded: false,
    prefs: { ...PREFS_PADRAO },
    sessao: null,
    dias: {},
    gasshoAte: 0,

    load: async () => {
      const [prefs, sessao, dias] = await Promise.all([
        read<Partial<ZazenPrefs>>(KEYS.prefs),
        read<ZazenSessao | null>(KEYS.sessao),
        read<Record<string, number>>(KEYS.dias),
      ]);
      set({
        loaded: true,
        prefs: normalizarPrefs(prefs),
        dias: dias && typeof dias === 'object' ? dias : {},
        sessao: sessaoValida(sessao) ? sessao : null,
      });
      const atual = get().sessao;
      if (!atual) return;
      const agora = Date.now();
      if (faseEm(atual, agora) === 'fim') {
        // Terminou com o app fechado: os sinos já tocaram, só falta guardar.
        get().tick();
        return;
      }
      if (kinesisRodando()) {
        // O Kinesis tomou o motor nesse meio-tempo: o zazen acabou ali.
        get().ceder();
        return;
      }
      // O app abriu no meio do zazen: a notificação e o próximo sino seguem valendo.
      armar(atual);
    },

    tick: () => {
      const s = get().sessao;
      if (!s) {
        if (get().gasshoAte && Date.now() >= get().gasshoAte) set({ gasshoAte: 0 });
        return;
      }
      const agora = Date.now();
      if (faseEm(s, agora) !== 'fim') return;
      // O hōzenshō já soou (é do nativo); aqui o ensō se fecha e vem o gasshō.
      encerrar(s.minutos, s.fimEm);
      if (agora - s.fimEm < GASSHO_JANELA_MS) set({ gasshoAte: agora + GASSHO_MS });
    },

    setMinutos: (minutos) => {
      const prefs = { ...get().prefs, minutos: limitarMinutos(minutos) };
      set({ prefs });
      save(KEYS.prefs, prefs);
    },
    bumpMinutos: (delta) => get().setMinutos(get().prefs.minutos + delta),
    patchPrefs: (patch) => {
      const prefs = normalizarPrefs({ ...get().prefs, ...patch });
      set({ prefs });
      save(KEYS.prefs, prefs);
    },
    preview: (sound) => {
      try {
        KinesisTimer?.play(sound);
      } catch (err) {
        console.warn('[zazen] som falhou:', err);
      }
    },

    start: () => {
      const sessao = planejarSessao(get().prefs, Date.now());
      set({ sessao, gasshoAte: 0 });
      save(KEYS.sessao, sessao);
      armar(sessao);
    },
    stop: () => {
      const s = get().sessao;
      if (!s) return;
      const agora = Date.now();
      // Já no fim, o hōzenshō está soando: calar o motor cortaria o último sino.
      if (faseEm(s, agora) === 'fim') {
        get().tick();
        return;
      }
      armar(null);
      encerrar(minutosSentados(s, agora), agora);
    },
    ceder: () => {
      const s = get().sessao;
      if (!s) return;
      const agora = Date.now();
      encerrar(minutosSentados(s, agora), agora);
    },
    rearm: () => {
      const s = get().sessao;
      if (!s || kinesisRodando()) return;
      if (faseEm(s, Date.now()) === 'fim') {
        get().tick();
        return;
      }
      armar(s);
    },
  };
});

/** Hoje, em minutos sentados. */
export function minutosDeHoje(dias: Record<string, number>, agora: number = Date.now()): number {
  return dias[chaveDoDia(agora)] ?? 0;
}

/** Espera o Kinesis carregar (com limite): é ele quem diz se o motor está ocupado. */
function kinesisCarregado(): Promise<void> {
  if (useKinesis.getState().loaded) return Promise.resolve();
  return new Promise((resolve) => {
    const unsub = useKinesis.subscribe((s) => {
      if (s.loaded) {
        unsub();
        resolve();
      }
    });
    setTimeout(() => {
      unsub();
      resolve();
    }, 8000);
  });
}

let started = false;

/** Sobe o Zazen uma vez. Nunca lança: uma falha aqui não pode derrubar a Comentora. */
export async function startZazen(): Promise<void> {
  if (started) return;
  started = true;
  try {
    await kinesisCarregado();
    await useZazen.getState().load();
    AppState.addEventListener('change', (s) => {
      if (s === 'active') useZazen.getState().tick();
    });
    useKinesis.subscribe((k, antes) => {
      if (!useZazen.getState().sessao) return;
      if (k.timer?.running && !antes.timer?.running) {
        // O Kinesis começou: a linha do tempo do motor agora é dele. O zazen
        // termina aqui, em silêncio, com os minutos já sentados.
        useZazen.getState().ceder();
      } else if (antes.timer && !k.timer) {
        // "Voltar à configuração" do Kinesis cala o motor logo depois de limpar o
        // estado dele; o zazen segue, então volta a ser entregue em seguida.
        setTimeout(() => useZazen.getState().rearm(), 0);
      }
    });
  } catch (err) {
    console.warn('[zazen] init falhou:', err);
  }
}
