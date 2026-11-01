// Login Google nativo (@react-native-google-signin). O cliente OAuth do tipo
// Android é casado automaticamente por package name + SHA-1 do keystore — não
// há segredo embarcado no app. Escopos mínimos: youtube.readonly + drive.file.

import { GoogleSignin } from '@react-native-google-signin/google-signin';

import type { GoogleUser } from '../types';

export const SCOPES = [
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/drive.file',
  // Ler o vault inteiro Drive:/Aspis (inclui notas criadas no desktop), para o
  // leitor de notas in-app. drive.file só enxerga arquivos que o app criou.
  'https://www.googleapis.com/auth/drive.readonly',
];

export class NotSignedInError extends Error {
  constructor() {
    super('Conecte a sua conta Google em Configurações para usar este recurso.');
    this.name = 'NotSignedInError';
  }
}

export function configureGoogle(): void {
  GoogleSignin.configure({ scopes: SCOPES });
}

function toUser(data: { user: { email: string; name: string | null; photo: string | null } }): GoogleUser {
  return {
    email: data.user.email,
    name: data.user.name || data.user.email,
    photo: data.user.photo,
  };
}

export async function signIn(): Promise<GoogleUser | null> {
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  const resp = await GoogleSignin.signIn();
  if (resp.type === 'success') return toUser(resp.data);
  return null; // cancelado pelo usuário
}

export async function restoreSignIn(): Promise<GoogleUser | null> {
  try {
    if (!GoogleSignin.hasPreviousSignIn()) return null;
    const current = GoogleSignin.getCurrentUser();
    if (current) return toUser(current);
    const resp = await GoogleSignin.signInSilently();
    if (resp.type === 'success') return toUser(resp.data);
  } catch {
    // sessão expirada/sem rede → segue deslogado
  }
  return null;
}

export async function getAccessToken(): Promise<string> {
  try {
    if (!GoogleSignin.hasPreviousSignIn()) throw new NotSignedInError();
    if (!GoogleSignin.getCurrentUser()) await GoogleSignin.signInSilently();
    const { accessToken } = await GoogleSignin.getTokens();
    if (!accessToken) throw new NotSignedInError();
    return accessToken;
  } catch (e) {
    if (e instanceof NotSignedInError) throw e;
    throw new NotSignedInError();
  }
}

export async function signOutGoogle(): Promise<void> {
  try {
    await GoogleSignin.signOut();
  } catch {
    // já deslogado
  }
}
