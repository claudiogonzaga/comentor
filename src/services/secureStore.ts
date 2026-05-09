import * as SecureStore from 'expo-secure-store';

const API_KEY = 'comentor.geminiApiKey';

export async function saveApiKey(apiKey: string) {
  await SecureStore.setItemAsync(API_KEY, apiKey, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED,
  });
}

export async function getApiKey(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(API_KEY);
  } catch {
    return null;
  }
}

export async function deleteApiKey() {
  await SecureStore.deleteItemAsync(API_KEY);
}
