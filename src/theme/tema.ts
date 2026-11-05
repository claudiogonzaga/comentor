// O tema da Noosfera: terracota grego (o de sempre) ou espacial (o céu do Diángelos).
//
// As cores são constantes lidas na importação pelos StyleSheet de cada tela, então a
// escolha é lida aqui, de um arquivo, de forma síncrona, antes de qualquer tela, e
// trocar de tema reinicia o app.

import { File, Paths } from 'expo-file-system';
import * as Updates from 'expo-updates';

export type Tema = 'terracota' | 'espacial';

const arquivo = () => new File(Paths.document, 'tema.txt');

function ler(): Tema {
  try {
    const f = arquivo();
    return f.exists && f.textSync().trim() === 'espacial' ? 'espacial' : 'terracota';
  } catch {
    return 'terracota';
  }
}

/** O tema em uso nesta execução do app. */
export const TEMA: Tema = ler();
export const ESPACIAL = TEMA === 'espacial';

/** Grava a escolha e reinicia o app para todas as telas trocarem de cor. */
export async function trocarTema(tema: Tema): Promise<void> {
  if (tema === TEMA) return;
  const f = arquivo();
  if (!f.exists) f.create();
  f.write(tema);
  await Updates.reloadAsync();
}
