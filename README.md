# CoMentor 🦉

Coach de vida com IA. Uma corujinha sábia que usa argumentação persuasiva, ciências comportamentais e escalonamento emocional para te ajudar a manter hábitos saudáveis. **v1 foca em sono.**

> "porque toda pessoa precisa de uma voz sábia no ombro."

## Stack

- **Expo + React Native + TypeScript** (SDK 54)
- **Gemini API** (`gemini-3.1-flash-lite` por padrão; troca pra qualquer geração — 3.1, 2.5, 2.0 — nas configurações)
- **expo-speech** para TTS em pt-BR (auto-fala mensagens da Corujinha)
- **expo-speech-recognition** para STT em pt-BR (push-to-talk: segura o mic e fala)
- **SQLite** local para histórico, chat, streaks e prompt do sistema editável
- **expo-secure-store** para a API key (criptografada via Keystore)
- **expo-notifications** para os lembretes escalonados (5 níveis) + lembrete de preparação
- **GitHub Releases** como canal de update — app verifica releases e baixa o APK direto

## Recursos

- **5 níveis de escalonamento** com técnicas distintas de persuasão (Cialdini, Walker, Huberman)
- **Voz nativa**: a Corujinha fala em pt-BR automaticamente; usuário responde segurando o microfone
- **Argumento contra adiamento**: toda vez que o usuário aperta "+15min", a IA gera um contra-argumento e fala em voz alta antes de aceitar o snooze
- **Lembrete de preparação** (default ON): X minutos antes da hora marcada, lembra de uma respiração 2-2-4 e abre uma tela com animação guiada
- **Prompt editável**: usuário customiza personalidade/regras da IA em Configurações
- **Update in-app**: tela inicial mostra banner se houver versão nova no GitHub Releases

## Estrutura

```
src/
  components/         Owl (5 humores), StarryBackground, Button, Card,
                      ChatBubble, MicButton, TimePickerInput, ScreenContainer
  constants/          intensityLevels, promptTemplate (default + placeholders)
  screens/            Splash, Onboarding, Home, Chat, Settings, History,
                      Breathing
  services/           database, secureStore, gemini, voice, notifications,
                      streaks, fallbackMessages, updateChecker,
                      coach (orchestrator)
  store/              zustand
  theme/              colors, typography, spacing
  navigation/         RootNavigator (lida com taps em notificação)
  types/              tipos compartilhados
```

## Rodar localmente

```bash
npm install
npx expo start
```

Abra no Expo Go (Android) escaneando o QR. **Atenção:** o reconhecimento de voz e o lembrete de notificação só funcionam num build EAS preview/production, não no Expo Go.

## Build de APK (cloud)

Requer conta Expo (`npx eas-cli login`) — build acontece na nuvem.

```bash
npx eas-cli@latest build --platform android --profile preview
```

O perfil `preview` em `eas.json` produz APK direto. O resultado vem como link de download.

## Publicar uma release no GitHub

Quando você buildar uma versão nova, bumpa a versão em `app.json` e cria a release:

```bash
# 1. Editar app.json: "version": "1.2.0"
# 2. Buildar com EAS (apk em preview ou aab em production)
npx eas-cli@latest build --platform android --profile preview --non-interactive
# 3. Baixar o .apk gerado para ./builds/comentor-1.2.0.apk
# 4. Criar a release com o asset:
./scripts/release.sh 1.2.0 ./builds/comentor-1.2.0.apk "Notas da release"
```

O script `scripts/release.sh` cria a tag `v1.2.0`, a release no GitHub e anexa o APK.
A partir daí, qualquer usuário com versão menor verá o banner de atualização no app
e pode baixar o APK direto.

## Configuração de IA

Usuário cadastra a chave em **Configurações → Chave de API**. Obtém-se grátis em
[aistudio.google.com/apikey](https://aistudio.google.com/apikey).

A chave é **obrigatória** desde a v1.0.1 — o app exige antes de finalizar onboarding
e antes de salvar configurações. Em runtime, se o Gemini falhar (rede/quota), a Corujinha
usa o banco offline (45 mensagens pré-escritas, 3 tons × 5 níveis × 3 variações).

### Modelos suportados

Default: `gemini-3.1-flash-lite`. Trocável em Configurações:

- `gemini-3.1-flash-lite` (default), `gemini-3.1-flash`
- `gemini-2.5-flash-lite`, `gemini-2.5-flash`
- `gemini-2.0-flash-lite`, `gemini-2.0-flash` (fallback)

O botão **"Testar chave"** valida a chave contra o modelo selecionado e cai pelos modelos
mais antigos automaticamente se o escolhido não existir.

## Os 5 níveis de escalonamento

| Nível | Tom | Quando |
|-------|-----|--------|
| 1 | Sussurro gentil | No horário-alvo |
| 2 | Lembrete amigável | +1 intervalo |
| 3 | Alerta preocupado | +2 intervalos |
| 4 | Confronto firme | +3 intervalos |
| 5 | Ultimato compassivo | +4 intervalos |

A Corujinha muda de expressão visual conforme o nível.

## Permissões Android

- `POST_NOTIFICATIONS` (Android 13+)
- `SCHEDULE_EXACT_ALARM` / `USE_EXACT_ALARM` (lembretes precisos)
- `RECEIVE_BOOT_COMPLETED` (re-agenda alarmes após reboot)
- `VIBRATE` (haptics)
- `RECORD_AUDIO` (push-to-talk)

## Privacidade

- 100% local: nada de servidor próprio.
- API key armazenada apenas via Keystore do Android.
- Histórico do usuário só no SQLite do device.
- Mensagens enviadas para Gemini contêm contexto mínimo (horário, atraso, streak).
- STT é feito pelo reconhecedor nativo do Android (Google Speech Services no aparelho).
- TTS é feito offline pelo motor nativo do Android.

## Próximas fases

- Módulo de leitura
- Módulo de exercício
- Modo claro
- Mascote evolutivo (ovo → coruja sábia → coruja dourada)
- Auto-update sem precisar abrir GitHub (atualmente o app só leva ao link)
