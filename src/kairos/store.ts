// As tarefas do Kairós no telefone. Ficam em app_kv (entram no backup) e vão ao Mac
// pela sincronização (services/configSync.ts), uma chave por tarefa. No Mac, as IAs
// mexem nelas pelo MCP (kairos_mcp.py) e a mudança chega aqui pelo mesmo caminho.
import { create } from 'zustand';

import { getKV, setKV } from '../services/database';
import { limitesDaNota, type Tarefa } from './rules';

const KEY = 'kairos:tasks';
/** Quanto tempo a recém-concluída fica no lugar, desbotada, com o ↩️ Desfazer. */
export const LAPIDE_MS = 60_000;

export type Campos = Pick<Tarefa, 'titulo' | 'area' | 'notas' | 'prioridade' | 'prazo' | 'hora' | 'tipo' | 'urgente'>;

interface KairosState {
  loaded: boolean;
  tarefas: Tarefa[];
  /** "Pular por enquanto": some só nesta sessão do app. */
  pulados: Record<string, true>;
  /** Concluídas há pouco (id → instante), para a lápide. */
  lapides: Record<string, number>;
  load: () => Promise<void>;
  criar: (campos: Campos) => void;
  atualizar: (id: string, campos: Partial<Campos>) => void;
  concluir: (id: string, estrelas: number, badges: string[], comentario: string) => void;
  concluirRapido: (id: string) => void;
  reabrir: (id: string) => void;
  excluir: (id: string) => void;
  pular: (id: string) => void;
  /** O que veio do Mac: a tarefa inteira, ou null quando ela foi apagada lá. */
  applySynced: (id: string, value: Tarefa | null) => void;
}

function uuid(): string {
  const hex = '0123456789abcdef';
  let s = '';
  for (let i = 0; i < 36; i += 1) {
    if (i === 8 || i === 13 || i === 18 || i === 23) s += '-';
    else if (i === 14) s += '4';
    else if (i === 19) s += hex[8 + Math.floor(Math.random() * 4)];
    else s += hex[Math.floor(Math.random() * 16)];
  }
  return s;
}

const agora = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

function salvar(tarefas: Tarefa[]): void {
  void setKV(KEY, JSON.stringify(tarefas)).catch((err) => console.warn('[kairos] não salvou', err));
}

let loading: Promise<void> | null = null;

export const useKairos = create<KairosState>((set, get) => {
  /** Troca uma tarefa por uma versão nova dela e grava. */
  const mudar = (id: string, fn: (t: Tarefa) => Tarefa) => {
    const tarefas = get().tarefas.map((t) => (t.id === id ? { ...fn(t), atualizadoEm: agora() } : t));
    set({ tarefas });
    salvar(tarefas);
  };

  return {
    loaded: false,
    tarefas: [],
    pulados: {},
    lapides: {},

    load: () => {
      if (get().loaded) return Promise.resolve();
      loading ??= (async () => {
        try {
          const raw = await getKV(KEY);
          const tarefas = raw ? (JSON.parse(raw) as Tarefa[]) : [];
          set({ loaded: true, tarefas: Array.isArray(tarefas) ? tarefas : [] });
        } catch (err) {
          // Sem ler, nada de "loaded": a sincronização não pode tomar o vazio por exclusão.
          console.warn('[kairos] não leu as tarefas', err);
        } finally {
          loading = null;
        }
      })();
      return loading;
    },

    criar: (campos) => {
      const ts = agora();
      const nova: Tarefa = {
        id: uuid(),
        ...campos,
        status: 'A fazer',
        estrelas: 0,
        badges: [],
        comentario: '',
        criadoEm: ts,
        concluidoEm: '',
        atualizadoEm: ts,
      };
      const tarefas = [...get().tarefas, nova];
      set({ tarefas });
      salvar(tarefas);
    },

    atualizar: (id, campos) => mudar(id, (t) => ({ ...t, ...campos })),

    concluir: (id, estrelas, badges, comentario) => {
      const { cap, piso } = limitesDaNota(badges);
      const nota = estrelas ? Math.max(piso, Math.min(estrelas, cap)) : 0;
      mudar(id, (t) => ({ ...t, status: 'Feito', estrelas: nota, badges, comentario, concluidoEm: agora() }));
      set({ lapides: { ...get().lapides, [id]: Date.now() } });
    },

    // O ✓ rápido: conclui sem avaliar (a avaliação que já houver fica).
    concluirRapido: (id) => {
      mudar(id, (t) => ({ ...t, status: 'Feito', concluidoEm: agora() }));
      set({ lapides: { ...get().lapides, [id]: Date.now() } });
    },

    reabrir: (id) => {
      mudar(id, (t) => ({ ...t, status: 'A fazer', concluidoEm: '' }));
      const { [id]: _, ...lapides } = get().lapides;
      set({ lapides });
    },

    excluir: (id) => {
      const tarefas = get().tarefas.filter((t) => t.id !== id);
      set({ tarefas });
      salvar(tarefas);
    },

    pular: (id) => set({ pulados: { ...get().pulados, [id]: true } }),

    applySynced: (id, value) => {
      const atual = get().tarefas;
      // Guarda como veio: normalizar aqui mudaria o hash e a tarefa iria e voltaria.
      const tarefas =
        value === null
          ? atual.filter((t) => t.id !== id)
          : atual.some((t) => t.id === id)
            ? atual.map((t) => (t.id === id ? { ...value, id } : t))
            : [...atual, { ...value, id }];
      set({ tarefas });
      salvar(tarefas);
    },
  };
});

export function startKairos(): void {
  void useKairos.getState().load();
}
