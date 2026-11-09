// A CAIXA DE AVISOS: a caixa postal entre o usuário e a IA pessoal dele (v1.131).
//
// A IA (a tarefa agendada "Check-up do Trabalho", a rotina do Escudo, uma conversa
// no Claude Code…) deixa AVISOS — o resumo do que leu no e-mail, no WhatsApp, no
// Teams. Ele lê aqui ou no Mac, responde ou deixa RECADOS, que a IA lê na execução
// seguinte. Os dois sentidos usam o mesmo registro (o mesmo do Mac, avisos_store.py).
//
// Ficam em app_kv e vão ao Mac pela sincronização (services/configSync.ts), uma
// chave por aviso: aviso.<id>. A IA da nuvem não alcança o telefone: escreve no
// Drive e o Mac importa (o telefone, com drive.file, só enxerga o que ele criou).
import { create } from 'zustand';

import { getKV, setKV } from '../services/database';

const KEY = 'avisos:list';
/** Com mais de 60 dias, o aviso sai dos dois lados. */
export const AVISO_KEEP_MS = 60 * 24 * 3600 * 1000;
const TITULO_MAX = 140;
const TEXTO_MAX = 8000;

export interface Aviso {
  id: string;
  /** 'ia' = aviso da IA; 'eu' = recado dele para a IA. */
  de: 'ia' | 'eu';
  origem: string;
  titulo: string;
  texto: string;
  prioridade: 'normal' | 'alta';
  criado: number;
  resposta_a: string | null;
  /** Aviso da IA que ele já leu. */
  lido: number | null;
  /** Recado dele que a IA já leu. */
  visto_ia: number | null;
  arquivado: number | null;
}

function novoId(prefixo: string): string {
  const alfa = '0123456789abcdefghijklmnopqrstuvwxyz';
  let s = Date.now().toString(36);
  for (let i = 0; i < 4; i += 1) s += alfa[Math.floor(Math.random() * 36)];
  return prefixo + s;
}

const limpo = (v: unknown, max: number) => String(v ?? '').replace(/\r\n/g, '\n').trim().slice(0, max);
const ms = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
};

/** Um aviso vindo de fora (Mac, arquivo) na forma canônica — a mesma do Mac. */
export function normalizar(raw: unknown, id?: string): Aviso | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;
  return {
    id: String(id ?? a.id ?? novoId('a')),
    de: a.de === 'eu' ? 'eu' : 'ia',
    origem: limpo(a.origem, 40),
    titulo: limpo(a.titulo, TITULO_MAX),
    texto: limpo(a.texto, TEXTO_MAX),
    prioridade: a.prioridade === 'alta' ? 'alta' : 'normal',
    criado: ms(a.criado) ?? Date.now(),
    resposta_a: a.resposta_a ? String(a.resposta_a) : null,
    lido: ms(a.lido),
    visto_ia: ms(a.visto_ia),
    arquivado: ms(a.arquivado),
  };
}

function podar(lista: Aviso[]): Aviso[] {
  const limite = Date.now() - AVISO_KEEP_MS;
  return lista.filter((a) => a.criado >= limite);
}

function salvar(lista: Aviso[]): void {
  void setKV(KEY, JSON.stringify(lista)).catch((err) => console.warn('[avisos] não salvou', err));
}

export const naoLidos = (lista: Aviso[]) => lista.filter((a) => a.de === 'ia' && !a.lido && !a.arquivado).length;
export const recadosPendentes = (lista: Aviso[]) =>
  lista.filter((a) => a.de === 'eu' && !a.visto_ia && !a.arquivado).sort((x, y) => x.criado - y.criado);

interface AvisosState {
  loaded: boolean;
  avisos: Aviso[];
  load: () => Promise<void>;
  marcarLido: (id: string, lido?: boolean) => void;
  marcarTodosLidos: () => void;
  arquivar: (id: string, sim?: boolean) => void;
  apagar: (id: string) => void;
  /** Recado dele para a IA; com `respostaA`, responde a um aviso. */
  recado: (texto: string, respostaA?: string | null) => void;
  /** O que veio do Mac: o aviso inteiro, ou null quando foi apagado lá. */
  applySynced: (id: string, value: Aviso | null) => void;
  /** Sai daqui sem virar lápide (passou da idade). */
  esquecer: (id: string) => void;
}

let loading: Promise<void> | null = null;

export const useAvisos = create<AvisosState>((set, get) => {
  const trocar = (lista: Aviso[]) => {
    const podada = podar(lista);
    set({ avisos: podada });
    salvar(podada);
  };
  const mudar = (id: string, fn: (a: Aviso) => Aviso) => {
    if (!get().loaded) return;
    trocar(get().avisos.map((a) => (a.id === id ? fn(a) : a)));
  };

  return {
    loaded: false,
    avisos: [],

    load: () => {
      if (get().loaded) return Promise.resolve();
      if (!loading) {
        loading = (async () => {
          try {
            const raw = await getKV(KEY);
            const lista = raw ? (JSON.parse(raw) as unknown[]) : [];
            const avisos = (Array.isArray(lista) ? lista : [])
              .map((x) => normalizar(x))
              .filter((x): x is Aviso => !!x);
            set({ avisos: podar(avisos), loaded: true });
          } catch (err) {
            // Ilegível: fica sem carregar, para a sincronização não apagar o que está no Mac.
            console.warn('[avisos] não leu', err);
          } finally {
            loading = null;
          }
        })();
      }
      return loading;
    },

    marcarLido: (id, lido = true) => mudar(id, (a) => ({ ...a, lido: lido ? a.lido ?? Date.now() : null })),

    marcarTodosLidos: () => {
      if (!get().loaded) return;
      const agora = Date.now();
      trocar(get().avisos.map((a) => (a.de === 'ia' && !a.lido ? { ...a, lido: agora } : a)));
    },

    arquivar: (id, sim = true) =>
      mudar(id, (a) => ({
        ...a,
        arquivado: sim ? a.arquivado ?? Date.now() : null,
        lido: sim && a.de === 'ia' ? a.lido ?? Date.now() : a.lido,
      })),

    apagar: (id) => {
      if (!get().loaded) return;
      trocar(get().avisos.filter((a) => a.id !== id));
    },

    recado: (texto, respostaA = null) => {
      const t = limpo(texto, TEXTO_MAX);
      if (!t || !get().loaded) return;
      const alvo = respostaA && get().avisos.some((a) => a.id === respostaA) ? respostaA : null;
      const novo = normalizar({ id: novoId('r'), de: 'eu', titulo: '', texto: t, criado: Date.now(), resposta_a: alvo });
      if (novo) trocar([...get().avisos, novo]);
    },

    applySynced: (id, value) => {
      if (!get().loaded) return;
      const resto = get().avisos.filter((a) => a.id !== id);
      if (value === null) {
        trocar(resto);
        return;
      }
      const novo = normalizar(value, id);
      if (novo) trocar([...resto, novo]);
    },

    esquecer: (id) => {
      if (!get().loaded) return;
      trocar(get().avisos.filter((a) => a.id !== id));
    },
  };
});
