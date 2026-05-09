# CoMentor 🦉

Coach de vida com IA. Uma corujinha sábia que usa argumentação persuasiva, ciências comportamentais e escalonamento emocional para te ajudar a manter hábitos saudáveis. **v1 foca em sono.**

> "porque toda pessoa precisa de uma voz sábia no ombro."

## Stack

- **Expo + React Native + TypeScript** (SDK 54)
- **Gemini API** (`gemini-2.0-flash-lite` por padrão; troca pra `flash` nas configurações)
- **SQLite** local para histórico, chat e streaks
- **expo-secure-store** para a API key (criptografada via Keystore)
- **expo-notifications** para os lembretes escalonados (5 níveis)

## Estrutura

```
src/
  components/         Owl, StarryBackground, Button, Card, ChatBubble
  constants/          Configuração de níveis de intensidade (1–5)
  screens/            Splash, Onboarding, Home, Chat, Settings, History
  services/           database, secureStore, gemini, notifications,
                      streaks, fallbackMessages, coach (orchestrator)
  store/              zustand
  theme/              colors, typography, spacing
  navigation/         RootNavigator
  types/              tipos compartilhados
```

## Rodar localmente

```bash
npm install
npx expo start
```

Abra no Expo Go (Android) escaneando o QR. Ou rode em emulador com `npm run android`.

## Build de APK

Requer conta Expo (`npx eas-cli login`) — build acontece na nuvem.

```bash
npx eas-cli@latest build --platform android --profile preview
```

O perfil `preview` em `eas.json` produz APK direto. O resultado vem como link de download.

## Configuração de IA

Usuário cadastra a chave em **Configurações → Chave de API**. Obtém-se grátis em
[aistudio.google.com/apikey](https://aistudio.google.com/apikey).

Se não houver chave, o app usa um banco local de mensagens pré-escritas (modo offline,
sinalizado na UI).

## Os 5 níveis de escalonamento

| Nível | Tom | Quando |
|-------|-----|--------|
| 1 | Sussurro gentil | No horário-alvo |
| 2 | Lembrete amigável | +1 intervalo |
| 3 | Alerta preocupado | +2 intervalos |
| 4 | Confronto firme | +3 intervalos |
| 5 | Ultimato compassivo | +4 intervalos |

A Corujinha muda de expressão visual conforme o nível. Cada nível usa uma técnica
diferente de persuasão (Cialdini, Walker, Huberman, framing de ganho/perda, etc.).

## Permissões Android

- `POST_NOTIFICATIONS` (Android 13+)
- `SCHEDULE_EXACT_ALARM` / `USE_EXACT_ALARM` (lembretes precisos)
- `RECEIVE_BOOT_COMPLETED` (re-agenda alarmes após reboot)
- `VIBRATE` (haptics na notificação)

## Privacidade

- 100% local: nada de servidor próprio.
- API key armazenada apenas via Keystore do Android.
- Histórico do usuário só no SQLite do device.
- Mensagens enviadas para Gemini contêm contexto mínimo (horário, atraso, streak).

## Próximas fases

- Módulo de leitura
- Módulo de exercício
- Modo claro
- Mascote evolutivo (ovo → coruja sábia → coruja dourada)
- Som de notificação customizado
