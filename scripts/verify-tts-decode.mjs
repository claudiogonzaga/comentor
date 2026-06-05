// Verificação SEM CHAVE da lógica que quebrava o Gemini TTS.
// Copia VERBATIM base64ToBytes + buildWavHeader + pcmToWav de src/services/geminiTTS.ts
// e valida contra os casos que o atob do Hermes rejeita.

const SAMPLE_RATE = 24000;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;

const B64_LUT = (() => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const t = new Int8Array(256).fill(-1);
  for (let i = 0; i < chars.length; i++) t[chars.charCodeAt(i)] = i;
  t[45] = 62; // '-'
  t[95] = 63; // '_'
  return t;
})();

function base64ToBytes(b64) {
  const lut = B64_LUT;
  let validLen = 0;
  for (let i = 0; i < b64.length; i++) {
    if (lut[b64.charCodeAt(i) & 0xff] >= 0) validLen++;
  }
  const out = new Uint8Array(Math.floor((validLen * 3) / 4));
  let acc = 0, bits = 0, o = 0;
  for (let i = 0; i < b64.length; i++) {
    const v = lut[b64.charCodeAt(i) & 0xff];
    if (v < 0) continue;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) { bits -= 8; out[o++] = (acc >> bits) & 0xff; }
  }
  return out;
}

function buildWavHeader(pcmByteLength) {
  const header = new Uint8Array(44);
  const dv = new DataView(header.buffer);
  let off = 0;
  const writeStr = (s) => { for (let i = 0; i < s.length; i++) header[off++] = s.charCodeAt(i); };
  const writeU32 = (v) => { dv.setUint32(off, v, true); off += 4; };
  const writeU16 = (v) => { dv.setUint16(off, v, true); off += 2; };
  const byteRate = SAMPLE_RATE * CHANNELS * (BITS_PER_SAMPLE / 8);
  const blockAlign = CHANNELS * (BITS_PER_SAMPLE / 8);
  writeStr('RIFF'); writeU32(36 + pcmByteLength); writeStr('WAVE');
  writeStr('fmt '); writeU32(16); writeU16(1); writeU16(CHANNELS);
  writeU32(SAMPLE_RATE); writeU32(byteRate); writeU16(blockAlign); writeU16(BITS_PER_SAMPLE);
  writeStr('data'); writeU32(pcmByteLength);
  return header;
}
function pcmToWav(pcm) {
  const header = buildWavHeader(pcm.length);
  const wav = new Uint8Array(header.length + pcm.length);
  wav.set(header, 0); wav.set(pcm, header.length);
  return wav;
}

// ---- helpers de teste ----
let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; console.log('  PASS', name); } else { fail++; console.log('  FAIL', name); } };
const eqBytes = (a, b) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };
const str = new TextDecoder('latin1');

// PCM "real": uma senoide de 24kHz mono 16-bit (1s) — mimetiza a saída do Gemini.
function makeSinePcm(ms = 1000, freq = 220) {
  const n = Math.round((SAMPLE_RATE * ms) / 1000);
  const pcm = new Uint8Array(n * 2);
  const dv = new DataView(pcm.buffer);
  for (let i = 0; i < n; i++) {
    const s = Math.round(Math.sin((2 * Math.PI * freq * i) / SAMPLE_RATE) * 30000);
    dv.setInt16(i * 2, s, true);
  }
  return pcm;
}

const pcm = makeSinePcm(1000);
const stdB64 = Buffer.from(pcm).toString('base64'); // com padding '='

console.log('1) Decoder base64 vs bytes originais (casos que QUEBRAVAM o atob do Hermes):');
// (a) padrão com padding
ok(eqBytes(base64ToBytes(stdB64), pcm), 'base64 padrão (com =) decodifica idêntico');
// (b) SEM padding (atob estrito quebra)
ok(eqBytes(base64ToBytes(stdB64.replace(/=+$/, '')), pcm), 'base64 SEM padding decodifica idêntico');
// (c) URL-safe (-_ no lugar de +/) — atob padrão quebra
const urlSafe = stdB64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
ok(eqBytes(base64ToBytes(urlSafe), pcm), 'base64 URL-safe (-_) decodifica idêntico');
// (d) com quebras de linha/espaços no meio (resposta "suja")
const withWs = stdB64.replace(/(.{76})/g, '$1\n  ');
ok(eqBytes(base64ToBytes(withWs), pcm), 'base64 com \\n e espaços decodifica idêntico');
// (e) concordância total com o decodificador de referência (Node Buffer)
ok(eqBytes(base64ToBytes(stdB64), new Uint8Array(Buffer.from(stdB64, 'base64'))), 'bate byte-a-byte com Buffer.from(base64)');

console.log('2) WAV gerado é válido e tocável:');
const wav = pcmToWav(pcm);
ok(str.decode(wav.slice(0, 4)) === 'RIFF', "cabeçalho começa com 'RIFF'");
ok(str.decode(wav.slice(8, 12)) === 'WAVE', "contém 'WAVE'");
ok(str.decode(wav.slice(12, 16)) === 'fmt ', "contém bloco 'fmt '");
ok(str.decode(wav.slice(36, 40)) === 'data', "contém bloco 'data'");
const dv = new DataView(wav.buffer);
ok(dv.getUint32(24, true) === 24000, 'sample rate = 24000 Hz');
ok(dv.getUint16(22, true) === 1, 'mono (1 canal)');
ok(dv.getUint16(34, true) === 16, '16 bits por amostra');
ok(dv.getUint32(4, true) === 36 + pcm.length, 'RIFF chunk size correto');
ok(dv.getUint32(40, true) === pcm.length, 'data chunk size = tamanho do PCM');
const durSec = pcm.length / 2 / SAMPLE_RATE;
ok(Math.abs(durSec - 1.0) < 0.001, `duração ≈ 1.000s (medido ${durSec.toFixed(3)}s)`);

console.log('3) Concatenação de múltiplos trechos (leitura longa = 1 WAV só):');
const parts = [makeSinePcm(500, 200), makeSinePcm(500, 300), makeSinePcm(500, 440)];
let totalLen = 0; for (const p of parts) totalLen += p.length;
const allPcm = new Uint8Array(totalLen);
let o = 0; for (const p of parts) { allPcm.set(p, o); o += p.length; }
const bigWav = pcmToWav(allPcm);
const dv2 = new DataView(bigWav.buffer);
ok(dv2.getUint32(40, true) === totalLen, '3 trechos concatenados → data size somado correto');
const bigDur = totalLen / 2 / SAMPLE_RATE;
ok(Math.abs(bigDur - 1.5) < 0.001, `duração total ≈ 1.500s (medido ${bigDur.toFixed(3)}s)`);

// grava um WAV de amostra pra inspeção opcional
import { writeFileSync } from 'node:fs';
writeFileSync('/tmp/tts-verify-sample.wav', Buffer.from(bigWav));
console.log('   (WAV de amostra salvo em /tmp/tts-verify-sample.wav —', bigWav.length, 'bytes)');

console.log(`\nRESULTADO: ${pass} passaram, ${fail} falharam`);
process.exit(fail === 0 ? 0 : 1);
