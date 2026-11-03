// Aviso de que algo sincronizável mudou aqui no telefone. Fica à parte para os
// serviços de lembretes avisarem sem importar configSync, que importa todos eles.

type Listener = () => void;

const listeners = new Set<Listener>();

export function notifyLocalChange(): void {
  listeners.forEach((l) => l());
}

export function onLocalChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
