# CoMentor 🦉

Coach de vida com IA. Uma corujinha sábia que usa argumentação persuasiva, ciências comportamentais e escalonamento emocional para te ajudar a manter hábitos saudáveis. **v1 foca em sono.**

> "porque toda pessoa precisa de uma voz sábia no ombro."

## Stack

- **Expo + React Native + TypeScript** (SDK 54)
- **Gemini API** (`gemini-3.1-flash-lite` por padrão, com **thinking budget máximo (24576 tokens)** em toda chamada — qualquer geração 3.1, 2.5 ou 2.0 selecionável em Configurações)
- **expo-speech** para TTS em pt-BR (auto-fala mensagens da Corujinha)
- **expo-speech-recognition** para STT em pt-BR (push-to-talk: segura o mic e fala)
- **SQLite** local para histórico, chat, streaks e prompt do sistema editável
- **expo-secure-store** para a API key (criptografada via Keystore)
- **expo-notifications** para os lembretes escalonados (5 níveis) + lembrete de preparação
- **GitHub Releases** como canal de update de APK (mudanças nativas) + **EAS Update / OTA** (mudanças só de JS)

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

Use esse fluxo só quando você **mudou código nativo** (adicionou/removeu lib com binding nativo,
mexeu em `app.json` `plugins`, mexeu em permissões, etc). Pra mudança só de JS use OTA (abaixo).

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

## OTA (Over-the-Air) — atualização sem rebuild

Pra correção que mexe **só em JS/TypeScript** (componentes, prompts, lógica do coach,
serviços que não tocam código nativo), use EAS Update — chega no celular do usuário em
segundos, sem ele precisar reinstalar APK.

### Setup inicial (faz uma vez)

```bash
npx eas-cli@latest update:configure
```

Isso preenche `expo.updates.url` no `app.json` com a URL do projeto. Commita esse arquivo.

Depois desse setup, você **precisa rebuildar o APK uma vez** pra que o app passe a saber
checar OTA. A partir desse build, qualquer mudança JS chega via OTA.

### Publicar um OTA

```bash
npx eas-cli@latest update --branch preview --message "fix: descrição curta"
```

`--branch preview` casa com o `channel: "preview"` do build profile em `eas.json`. Trocar
pra `production` quando estiver mantendo o canal estável.

O app verifica updates ao abrir e baixa em background. Aplica na próxima vez que o usuário
abrir o app.

### Quando NÃO funciona via OTA (e você é obrigado a rebuildar)

- Mudou versão de qualquer lib com código nativo (ex: `llama.rn`, `expo-secure-store`)
- Adicionou/removeu plugin em `app.json`
- Mexeu em permissões Android/iOS
- Mudou ícones, splash, ou qualquer asset binário do app

A política `runtimeVersion.policy = "fingerprint"` em `app.json` detecta isso automaticamente:
se o fingerprint nativo mudar, OTAs novos vão pra um runtime version diferente e o build
antigo simplesmente não recebe o update incompatível.

## Configuração de IA

Usuário cadastra a chave em **Configurações → Chave de API**. Obtém-se grátis em
[aistudio.google.com/apikey](https://aistudio.google.com/apikey).

A chave era obrigatória até a v1.2; a partir da v1.3 é opcional — alternativa é baixar um
modelo open-source que roda no celular (Gemma 4 E4B, Qwen3-4B-Thinking-2507, Qwen3.5-4B).

Em runtime, se o Gemini falhar (rede/quota) ou o modelo local não estiver carregado, a
Corujinha usa o banco offline (45 mensagens pré-escritas, 3 tons × 5 níveis × 3 variações).

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
