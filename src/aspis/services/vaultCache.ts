// Cache em memória da última lista do vault, para o NoteReader resolver
// [[wikilinks]] (nome → fileId) sem recarregar do Drive.
import type { VaultNote } from './drive';

let cache: VaultNote[] = [];

export function setVaultCache(notes: VaultNote[]): void {
  cache = notes;
}

export function getVaultCache(): VaultNote[] {
  return cache;
}

export function findByName(name: string): VaultNote | null {
  return cache.find((n) => n.name === name) ?? null;
}
