# Prompt para construir o app de macOS "Leia pra Mim — Audiobooks do Drive"

> Copie tudo abaixo da linha e cole numa nova conversa com o Claude (de
> preferência Claude Code, com acesso ao terminal e ao sistema de arquivos).

---

## Contexto e objetivo

Quero que você construa um **aplicativo nativo para macOS** chamado **"Leia pra
Mim — Audiobooks"**. Ele é derivado de uma funcionalidade chamada "Leia para
mim" de um app mobile (React Native) meu, e deve **reaproveitar ao máximo a
interface e o design** dela (descrevo abaixo). A função do app de macOS é:

1. O usuário **cola o link de uma pasta do Google Drive** (pasta de ORIGEM, com
   arquivos de texto).
2. O usuário **cola o link de outra pasta do Google Drive** (pasta de DESTINO —
   pode ser a mesma).
3. O usuário informa uma **chave de API do Google Gemini** e escolhe uma **voz
   Gemini**.
4. Ao clicar em "Gerar audiobooks", o app:
   - lê **todos os arquivos de texto** da pasta de origem (`.txt`, `.md`; bônus:
     `.pdf`/`.docx` extraindo o texto),
   - converte cada texto em **áudio narrado (audiobook)** usando a **TTS do
     Gemini** (vozes Gemini),
   - **codifica o resultado em MP3**,
   - **faz upload de cada MP3 para a pasta de destino do Drive**, com o mesmo
     nome-base do arquivo de origem (ex.: `capitulo-1.txt` → `capitulo-1.mp3`).
5. Mostra **progresso por arquivo** (gerando 3/12…), permite cancelar, e relata
   sucessos/erros ao final.

## Stack recomendada (decida e justifique)

Para **reaproveitar a UI/design** (que é React/TypeScript) e ter acesso a
sistema de arquivos + rede + OAuth, recomendo **Electron + React + TypeScript**
(empacotado como `.app`/`.dmg` para macOS via `electron-builder`). Alternativa:
**Tauri** (menor, Rust no backend) — use se preferir. **Não** use SwiftUI, pois
perderíamos o reaproveitamento do código React. Tome a decisão e explique em 2
linhas; o importante é entregar um app de macOS funcional.

Sugestão de arquitetura no Electron:
- **Processo de renderização (React)**: a tela, idêntica em espírito ao "Leia
  para mim" (descrita abaixo).
- **Processo principal (Node)**: chamadas à API Gemini TTS, encode MP3
  (via `ffmpeg-static` + `fluent-ffmpeg`, ou `lamejs`), e Google Drive API.
  Exponha funções ao renderer por `contextBridge`/IPC.
- Guarde a chave Gemini e os tokens OAuth com `safeStorage` do Electron (ou
  `keytar`). Nunca logue a chave.

## Design / UI a reaproveitar (tela "Leia para mim")

Reproduza este visual e tom (terracota com figura escura, estilo sóbrio):

- **Tema**: fundo terracota (`#C8703F` → gradiente para `#B05A30`); texto
  primário escuro `#2A1A10`; superfícies translúcidas escuras
  `rgba(42,26,16,0.16)`; detalhe/ação na cor escura `#2A1A10` (a paleta é
  "figura negra sobre terracota", como cerâmica grega). Fontes limpas; títulos
  em peso médio.
- **Cabeçalho**: título "Leia pra Mim — Audiobooks".
- **Campos** (cards arredondados, com rótulo em maiúsculas pequeno):
  1. "PASTA DE ORIGEM (Google Drive)" — input de texto para colar o link +
     botão "Conectar Google Drive" (OAuth) se ainda não conectado.
  2. "PASTA DE DESTINO (Google Drive)" — input; um checkbox "usar a mesma pasta".
  3. "CHAVE GEMINI" — input protegido (secure) + link "Obtenha sua chave grátis"
     → https://aistudio.google.com/apikey.
  4. "VOZ DA LEITURA" — seletor com as vozes Gemini (lista abaixo) e um botão
     "ouvir prévia" (sintetiza uma frase curta).
  5. (opcional) "Velocidade" (0.7–1.3) e "Leitura pausada" (insere pequenas
     pausas entre frases) — herdados do "Leia para mim".
- **Botão primário grande**: "Gerar audiobooks".
- **Lista de progresso**: cada arquivo com nome, status (na fila / gerando /
  enviando / ✓ pronto / ✗ erro) e uma barrinha de progresso; um botão "Cancelar".
- **Player de prévia** opcional (▶/⏸, barra arrastável, botão ⟲30 que volta 30s)
  para ouvir um audiobook gerado antes do upload — exatamente como o player do
  "Leia para mim".

## Detalhes técnicos da TTS Gemini (REAPROVEITE esta lógica)

O modelo de TTS retorna **PCM 16-bit little-endian, mono, 24 kHz**, em base64.
Para virar um arquivo tocável, montamos um cabeçalho WAV (44 bytes) na frente do
PCM; depois transcodificamos para MP3. Detalhes verificados e em produção no meu
app:

- **Modelo**: `gemini-2.5-flash-preview-tts`
- **Endpoint**:
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=SUA_CHAVE`
- **Corpo da requisição** (POST, `Content-Type: application/json`):

```json
{
  "contents": [{ "parts": [{ "text": "TEXTO A NARRAR" }] }],
  "generationConfig": {
    "responseModalities": ["AUDIO"],
    "speechConfig": { "voiceConfig": { "prebuiltVoiceConfig": { "voiceName": "Aoede" } } }
  }
}
```

- **Resposta**: o áudio vem em
  `candidates[0].content.parts[0].inlineData.data` (base64 do PCM).
- **Parâmetros de áudio**: `SAMPLE_RATE = 24000`, `CHANNELS = 1`,
  `BITS_PER_SAMPLE = 16`.

### Montagem do WAV (cabeçalho de 44 bytes) — reaproveite

```ts
const SAMPLE_RATE = 24000, CHANNELS = 1, BITS_PER_SAMPLE = 16;

function buildWavHeader(pcmByteLength: number): Uint8Array {
  const header = new Uint8Array(44);
  const dv = new DataView(header.buffer);
  let off = 0;
  const writeStr = (s: string) => { for (let i = 0; i < s.length; i++) header[off++] = s.charCodeAt(i); };
  const writeU32 = (v: number) => { dv.setUint32(off, v, true); off += 4; };
  const writeU16 = (v: number) => { dv.setUint16(off, v, true); off += 2; };
  const byteRate = SAMPLE_RATE * CHANNELS * (BITS_PER_SAMPLE / 8);
  const blockAlign = CHANNELS * (BITS_PER_SAMPLE / 8);
  writeStr('RIFF'); writeU32(36 + pcmByteLength); writeStr('WAVE');
  writeStr('fmt '); writeU32(16); writeU16(1); writeU16(CHANNELS);
  writeU32(SAMPLE_RATE); writeU32(byteRate); writeU16(blockAlign); writeU16(BITS_PER_SAMPLE);
  writeStr('data'); writeU32(pcmByteLength);
  return header;
}

function pcmToWav(pcm: Uint8Array): Uint8Array {
  const header = buildWavHeader(pcm.length);
  const wav = new Uint8Array(header.length + pcm.length);
  wav.set(header, 0); wav.set(pcm, header.length);
  return wav;
}
```

### Textos longos: divida em pedaços e concatene o PCM

O modelo tem limite por chamada e fica mais robusto com pedaços ~3500 caracteres.
Quebre o texto em blocos **respeitando fim de frase/parágrafo**, sintetize cada
bloco, **concatene os PCMs** (não os WAVs!) e só então monte UM WAV do PCM
inteiro → encode para MP3. Assim o audiobook fica contínuo, sem "emendas".
Pseudo:

```ts
function chunkText(text: string, maxLen = 3500): string[] { /* corta em parágrafos/frases */ }

async function synthChunkPcm(text: string, voice: string, apiKey: string): Promise<Uint8Array> {
  // POST conforme acima → base64 → Uint8Array (PCM)
}

async function textToWav(fullText: string, voice: string, apiKey: string): Promise<Uint8Array> {
  const chunks = chunkText(fullText);
  const pcms: Uint8Array[] = [];
  for (const c of chunks) pcms.push(await synthChunkPcm(c, voice, apiKey));
  const total = pcms.reduce((n, p) => n + p.length, 0);
  const all = new Uint8Array(total);
  let off = 0; for (const p of pcms) { all.set(p, off); off += p.length; }
  return pcmToWav(all);
}
```

> **Dicas de robustez aprendidas no meu app**: (a) normalize o VOLUME de cada
> bloco para um RMS-alvo, senão o volume "pula" entre pedaços; (b) o TTS tem
> limite de **~10 requisições por minuto** — ritme as chamadas (1 a cada ~6s) e
> trate `429` com backoff; (c) a cota DIÁRIA (RPD) é o gargalo real — informe o
> usuário se estourar; (d) decodifique o base64 de forma robusta.

### WAV → MP3

No processo Node, transcodifique o WAV para MP3 com **ffmpeg** (recomendado):
use `ffmpeg-static` (binário embutido, sem instalação) + `fluent-ffmpeg`, algo
como `-codec:a libmp3lame -q:a 4`. Alternativa pura-JS: `lamejs`.

### Velocidade / pausas (opcional, herdado do "Leia para mim")

- Velocidade: aplique no MP3 via ffmpeg `atempo` (0.7–1.3) ou peça ao usuário.
- "Leitura pausada": insira ~400ms de silêncio (PCM zeros) entre frases antes de
  montar o WAV.

### Vozes Gemini disponíveis (use esta lista no seletor)

| name (id da API) | gênero | descrição |
|---|---|---|
| Aoede (padrão) | feminina | leve e expressiva |
| Kore | feminina | casual e direta |
| Leda | feminina | jovem e alegre |
| Zephyr | feminina | suave e calma |
| Charon | masculina | articulada e neutra |
| Puck | masculina | leve e simpática |
| Fenrir | masculina | firme e grave |
| Orus | masculina | calma e ponderada |

(A API tem mais vozes pré-construídas; estas estão verificadas em produção.)

## Integração com o Google Drive

- **Autenticação**: OAuth 2.0 (escopo `https://www.googleapis.com/auth/drive` ou
  o mais restrito `drive.file` se possível). No Electron, abra a janela de
  consentimento e capture o code via loopback `http://127.0.0.1:PORT`. Guarde o
  refresh token com `safeStorage`/`keytar`. Documente onde o usuário cria as
  credenciais OAuth (Google Cloud Console → APIs e serviços → Credenciais).
- **Extrair o ID da pasta do link**: o usuário cola URLs como
  `https://drive.google.com/drive/folders/<ID>` ou `.../folders/<ID>?usp=sharing`.
  Faça parse do `<ID>` por regex.
- **Listar arquivos da origem**: Drive API `files.list` com
  `q="'<FOLDER_ID>' in parents and trashed=false"`, filtrando por mimeType de
  texto (`text/plain`, `text/markdown`) — bônus: `application/pdf`,
  `application/vnd.google-apps.document` (export como `text/plain`),
  `.docx` (extraia com `mammoth`).
- **Baixar o texto**: `files.get` com `alt=media` (ou `files.export` para Google
  Docs). Para PDF, extraia texto com `pdf-parse`.
- **Upload do MP3**: `files.create` (multipart) com `parents=[<DEST_FOLDER_ID>]`,
  `name="<base>.mp3"`, `mimeType="audio/mpeg"`. Se já existir um arquivo com o
  mesmo nome, ofereça pular/sobrescrever.

## Comportamento e UX

- Processa os arquivos **em série** (ou no máx. 1–2 em paralelo) para respeitar o
  limite de RPM do TTS.
- **Idempotência**: pule arquivos cujo `<base>.mp3` já exista no destino (com
  opção de reprocessar).
- **Cache local** opcional: salve os MP3 gerados numa pasta local
  (`~/Library/Application Support/<app>/out/`) antes do upload, para retomar se
  cair a conexão.
- **Erros claros**: chave inválida, sem permissão no Drive, cota excedida — tudo
  com mensagem amigável (em pt-BR) e sem travar a fila inteira.
- **Privacidade/segurança**: nunca registre a chave Gemini nem os tokens; não
  envie nada a terceiros além de Google (Gemini + Drive).

## Entregáveis

1. Projeto Electron (ou Tauri) **buildável em macOS** com `npm run dev` e
   `npm run dist` (gera `.dmg`/`.app` via electron-builder, target macOS,
   inclusive Apple Silicon).
2. README com: como obter a chave Gemini, como criar as credenciais OAuth do
   Drive, como rodar e empacotar.
3. Código TypeScript organizado: `tts.ts` (Gemini), `drive.ts` (Google Drive),
   `mp3.ts` (encode), e a UI React reaproveitando o visual do "Leia para mim".
4. Tratamento de cota/RPM, progresso por arquivo, cancelamento e idempotência.

Comece confirmando a stack escolhida e um plano curto de passos; depois
implemente. Pergunte se faltar alguma credencial/decisão (ex.: usar `drive` vs
`drive.file`), mas assuma padrões sensatos para não travar.
