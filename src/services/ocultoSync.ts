// Os cards ocultados no feed do Escudo, entre o telefone e o Mac (que segue a mesma
// regra). Uma chave por card, `aspis.oculto.<video_id>`, com o instante em que
// foi ocultado (epoch ms) ou null quando desfeito; vale a mudança mais recente de cada
// chave, como as outras do arquivo.
//
// Cada lado só publica o que mudou nos últimos 60 dias. Passado isso, só deixa de
// publicar: a ausência por idade NÃO vira null (diferente do done:, em que a marca
// sumida vira null) — o card continua oculto dos dois lados. Uma semana depois da
// janela, o item sai do arquivo.
//
// Fica à parte de configSync para ser testável sem o React Native: o banco entra por
// `aplicar`, e o hash, por parâmetro.

export const OCULTO_PREFIX = 'aspis.oculto.';
export const OCULTO_KEEP_MS = 60 * 86_400_000;
export const OCULTO_DROP_MS = OCULTO_KEEP_MS + 7 * 86_400_000;

export interface ItemOculto {
  t: number;
  by: string;
  v: unknown;
}

export interface EstadoOculto {
  hash: Record<string, string>;
  t: Record<string, number>;
}

/** O valor de uma chave: o instante (número) ou null; outra coisa é inválida (undefined). */
export function valorOculto(v: unknown): number | null | undefined {
  if (v === null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return undefined;
}

/** Quando o item mudou de fato: ocultado, o instante; desfeito, quando foi gravado. */
export function instanteOculto(item: ItemOculto): number {
  const v = valorOculto(item.v);
  return typeof v === 'number' ? v : item.t;
}

/** As chaves deste aparelho, a partir do que mudou dentro da janela (db.hiddenChanges). */
export function chavesOcultas(
  mudancas: { video_id: string; hidden_at: number | null }[],
): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const m of mudancas) out[`${OCULTO_PREFIX}${m.video_id}`] = m.hidden_at ?? null;
  return out;
}

/**
 * Grava aqui o que veio do outro aparelho: ocultado no instante dado, ou desfeito
 * (null), mudado em `t`. Mesmo sem o vídeo no banco (ele nasce oculto quando chegar).
 * Devolve true se o feed daqui mudou.
 */
export type AplicarOculto = (videoId: string, instante: number | null, t: number) => boolean;

export interface PassoOculto {
  /** O arquivo mudou e precisa ser regravado. */
  dirty: boolean;
  /** O feed daqui mudou: as telas releem o banco. */
  feed: boolean;
}

/**
 * Uma chave, de ponta a ponta. `local` é o que este aparelho publica (undefined quando
 * não publica: nunca viu a chave, ou ela já passou da janela). Mexe em `items` (o
 * arquivo) e em `state` (o visto da última passada), como o resto de configSync.
 */
export function syncOculto(
  key: string,
  local: number | null | undefined,
  items: Record<string, ItemOculto>,
  state: EstadoOculto,
  first: boolean,
  now: number,
  device: string,
  hash: (v: unknown) => string,
  aplicar: AplicarOculto,
): PassoOculto {
  const out: PassoOculto = { dirty: false, feed: false };
  const videoId = key.slice(OCULTO_PREFIX.length);
  const remote = items[key];
  const rv = remote ? valorOculto(remote.v) : undefined;
  // Valor estranho no arquivo: não mexe em nada, nem o apaga.
  if (remote && rv === undefined) return out;

  if (local === undefined) {
    // Nada daqui dentro da janela. A ausência não é um "desfazer": nunca vira null.
    delete state.hash[key];
    delete state.t[key];
    if (!remote) return out;
    const idade = now - instanteOculto(remote);
    if (idade > OCULTO_DROP_MS) {
      delete items[key];
      out.dirty = true;
      return out;
    }
    // Venceu a janela: deixa de valer como novidade; o banco daqui fica como está.
    if (idade > OCULTO_KEEP_MS) return out;
    // Novo do outro lado.
    out.feed = aplicar(videoId, rv as number | null, remote.t);
    state.hash[key] = hash(rv);
    state.t[key] = remote.t;
    return out;
  }

  const lh = hash(local);
  const changed = lh !== state.hash[key];
  const rt = remote?.t ?? 0;
  // O instante da versão daqui: agora, se acabou de mudar. No primeiro contato do
  // aparelho (reinstalação), o que está no arquivo manda.
  let lt = changed ? now : (state.t[key] ?? 0);
  if (first && remote) lt = 0;

  if (!remote) {
    // Só daqui. Desfeito antes de chegar ao arquivo: lá não há o que desfazer.
    if (local !== null) {
      items[key] = { t: lt || now, by: device, v: local };
      out.dirty = true;
    }
    state.t[key] = lt || now;
    state.hash[key] = lh;
    return out;
  }
  if (rt > lt) {
    // A de lá é a mais recente.
    if (hash(rv) !== lh) out.feed = aplicar(videoId, rv as number | null, rt);
    state.t[key] = rt;
    state.hash[key] = hash(rv);
    return out;
  }
  // A daqui é a mais recente (ou empatou). Também cura o caso de a gravação do outro
  // lado ter passado por cima desta: ela volta para o arquivo.
  if (lt > rt && hash(rv) !== lh) {
    items[key] = { t: lt, by: device, v: local };
    out.dirty = true;
  }
  state.t[key] = lt;
  state.hash[key] = lh;
  return out;
}
