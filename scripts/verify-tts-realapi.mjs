// Teste REAL contra a API do Gemini TTS, replicando fetchPcm do app.
// Lê a chave de /tmp/gkey.txt. NUNCA imprime a chave.
import { readFileSync, writeFileSync } from 'node:fs';

const KEY = readFileSync('/tmp/gkey.txt', 'utf8').trim();
const TTS_MODEL = 'gemini-2.5-flash-preview-tts';
const BASE = `https://generativelanguage.googleapis.com/v1beta/models/${TTS_MODEL}:generateContent`;
const SAMPLE_RATE = 24000, CHANNELS = 1, BITS = 16;
const TTS_TIMEOUT_MS = 90000;

const B64_LUT = (() => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const t = new Int8Array(256).fill(-1);
  for (let i = 0; i < chars.length; i++) t[chars.charCodeAt(i)] = i;
  t[45] = 62; t[95] = 63; return t;
})();
function base64ToBytes(b64) {
  const lut = B64_LUT; let validLen = 0;
  for (let i = 0; i < b64.length; i++) if (lut[b64.charCodeAt(i) & 0xff] >= 0) validLen++;
  const out = new Uint8Array(Math.floor((validLen * 3) / 4));
  let acc = 0, bits = 0, o = 0;
  for (let i = 0; i < b64.length; i++) {
    const v = lut[b64.charCodeAt(i) & 0xff]; if (v < 0) continue;
    acc = (acc << 6) | v; bits += 6;
    if (bits >= 8) { bits -= 8; out[o++] = (acc >> bits) & 0xff; }
  }
  return out;
}
function pcmToWav(pcm) {
  const h = new Uint8Array(44); const dv = new DataView(h.buffer); let off = 0;
  const ws = (s) => { for (let i = 0; i < s.length; i++) h[off++] = s.charCodeAt(i); };
  const u32 = (v) => { dv.setUint32(off, v, true); off += 4; };
  const u16 = (v) => { dv.setUint16(off, v, true); off += 2; };
  const byteRate = SAMPLE_RATE * CHANNELS * (BITS / 8), blockAlign = CHANNELS * (BITS / 8);
  ws('RIFF'); u32(36 + pcm.length); ws('WAVE'); ws('fmt '); u32(16); u16(1); u16(CHANNELS);
  u32(SAMPLE_RATE); u32(byteRate); u16(blockAlign); u16(BITS); ws('data'); u32(pcm.length);
  const wav = new Uint8Array(44 + pcm.length); wav.set(h, 0); wav.set(pcm, 44); return wav;
}

// monta a request em 3 esquemas de auth pra descobrir qual o token aceita
function buildReq(text, voice, mode) {
  const body = JSON.stringify({
    contents: [{ parts: [{ text }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
    },
  });
  const headers = { 'Content-Type': 'application/json' };
  let url = BASE;
  if (mode === 'key') url = `${BASE}?key=${encodeURIComponent(KEY)}`;           // como o app faz
  else if (mode === 'bearer') headers['Authorization'] = `Bearer ${KEY}`;
  else if (mode === 'access_token') url = `${BASE}?access_token=${encodeURIComponent(KEY)}`;
  return { url, headers, body };
}

async function callOnce(text, voice, mode) {
  const { url, headers, body } = buildReq(text, voice, mode);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TTS_TIMEOUT_MS);
  const t0 = Date.now();
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers, body, signal: ctrl.signal });
  } catch (e) {
    clearTimeout(timer);
    return { ok: false, ms: Date.now() - t0, err: e.name === 'AbortError' ? 'ABORTED (timeout)' : String(e.message || e) };
  }
  clearTimeout(timer);
  const ms = Date.now() - t0;
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    return { ok: false, status: res.status, ms, err: j?.error?.message || `HTTP ${res.status}` };
  }
  const json = await res.json();
  const data = json?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!data) return { ok: false, status: res.status, ms, err: 'resposta sem áudio (inlineData vazio)' };
  const pcm = base64ToBytes(data);
  return { ok: true, status: res.status, ms, b64len: data.length, pcm };
}

const VOICE = 'Aoede';
let workingMode = null;

console.log('== TESTE 1: trecho curto, descobrindo o esquema de auth do token ==');
const shortText = 'Olá! Esta é a Comentora testando a voz do Gemini. Se você está ouvindo isto com clareza, o áudio foi gerado e decodificado corretamente.';
for (const mode of ['key', 'bearer', 'access_token']) {
  process.stdout.write(`  auth='${mode}' … `);
  const r = await callOnce(shortText, VOICE, mode);
  if (r.ok) {
    const dur = r.pcm.length / 2 / SAMPLE_RATE;
    console.log(`OK · HTTP ${r.status} · ${r.ms}ms · ${r.pcm.length} bytes PCM · ~${dur.toFixed(2)}s áudio`);
    writeFileSync('/tmp/tts-real-1.wav', Buffer.from(pcmToWav(r.pcm)));
    workingMode = mode; break;
  } else {
    console.log(`falhou${r.status ? ' · HTTP ' + r.status : ''} · ${r.ms}ms · ${r.err}`);
  }
}

if (!workingMode) {
  console.log('\nNenhum esquema de auth funcionou com este token. (Veja mensagens acima.)');
  process.exit(2);
}
console.log(`\n→ esquema que funciona: '${workingMode}'  (app usa 'key')\n`);

console.log('== TESTE 2: trecho ~800 chars (tamanho do app no v1.36.0) — prova que NÃO dá "Aborted" ==');
const big = ('A Comentora é uma assistente que te ajuda a cuidar de hábitos saudáveis ao longo do dia. ').repeat(9).slice(0, 800);
console.log(`  enviando ${big.length} chars…`);
const r2 = await callOnce(big, VOICE, workingMode);
if (r2.ok) {
  const dur = r2.pcm.length / 2 / SAMPLE_RATE;
  console.log(`  OK · ${r2.ms}ms (limite 90000ms) · ~${dur.toFixed(2)}s áudio · ${r2.ms < TTS_TIMEOUT_MS ? 'DENTRO do timeout ✓' : 'ESTOUROU ✗'}`);
  writeFileSync('/tmp/tts-real-2.wav', Buffer.from(pcmToWav(r2.pcm)));
} else {
  console.log(`  FALHOU · ${r2.ms}ms · ${r2.err}`);
}

console.log('\n== TESTE 3: leitura longa multi-trecho → 1 WAV concatenado (como a tela "Leia para mim") ==');
const chunks = [
  'Respire fundo. Vamos começar um momento de calma juntos.',
  'Solte os ombros, relaxe o maxilar, e perceba o ar entrando e saindo.',
  'Você está fazendo o suficiente. Um passo de cada vez já é progresso.',
];
const pcms = []; let total = 0; let allOk = true;
for (let i = 0; i < chunks.length; i++) {
  const r = await callOnce(chunks[i], VOICE, workingMode);
  if (r.ok) { pcms.push(r.pcm); total += r.pcm.length; console.log(`  trecho ${i + 1}/${chunks.length}: OK · ${r.ms}ms`); }
  else { allOk = false; console.log(`  trecho ${i + 1}/${chunks.length}: FALHOU · ${r.err}`); }
}
if (allOk) {
  const all = new Uint8Array(total); let o = 0; for (const p of pcms) { all.set(p, o); o += p.length; }
  const wav = pcmToWav(all);
  writeFileSync('/tmp/tts-real-3.wav', Buffer.from(wav));
  console.log(`  concatenado: ${pcms.length} trechos · ${(total / 2 / SAMPLE_RATE).toFixed(2)}s · WAV ${wav.length} bytes → /tmp/tts-real-3.wav`);
}
console.log('\nFIM.');
