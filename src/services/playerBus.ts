// PLAYER ÚNICO: os players do app (Leia para mim, Minha sequência) se
// registram aqui. Quando um começa a tocar, chama claimPlayback(id) e o
// barramento PARA todos os outros — nunca dois áudios ao mesmo tempo.
// (Mediador para evitar import circular entre os stores.)

const stoppers = new Map<string, () => void>();

/** Registra (ou substitui) o "stop" de um player. */
export function registerPlayer(id: string, stop: () => void): void {
  stoppers.set(id, stop);
}

/** Reivindica a reprodução para `id`: para TODOS os outros players. */
export function claimPlayback(id: string): void {
  for (const [key, stop] of stoppers) {
    if (key === id) continue;
    try {
      stop();
    } catch {
      /* parar é best-effort */
    }
  }
}
