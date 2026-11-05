// A assinatura da Noosfera no que sai do app pela Comentora: o texto copiado leva uma
// linha no fim; o áudio compartilhado leva o nome no arquivo e uma legenda, que o
// WhatsApp e o Telegram mandam junto (o expo-sharing não leva texto, por isso o
// compartilhamento nativo do AspisMedia).

import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import AspisMedia from '../../modules/aspis-media';

export const ASSINATURA = 'Gerado pelo app Noosfera';

/** O texto com a linha da Noosfera no fim. */
export function assinarTexto(text: string): string {
  return `${text.trimEnd()}\n\n— ${ASSINATURA}`;
}

/** O nome do arquivo com a marca da Noosfera antes da extensão. */
export function nomeAssinado(base: string, ext: string): string {
  return `${base} (Noosfera).${ext}`;
}

/** Abre a folha de compartilhamento de um áudio com a legenda (texto já assinado). */
export async function compartilharAudio(
  uri: string,
  mime: string,
  dialogTitle: string,
  legenda: string,
  UTI?: string,
): Promise<void> {
  if (Platform.OS === 'android') {
    try {
      AspisMedia.shareFile(uri, mime, legenda, dialogTitle);
      return;
    } catch {
      /* sem o nativo: a folha comum, sem legenda */
    }
  }
  await Sharing.shareAsync(uri, { mimeType: mime, dialogTitle, UTI });
}
