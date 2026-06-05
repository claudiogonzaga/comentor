// Investiga o "An internal error has occurred" (HTTP 500) do Gemini TTS.
// Mede taxa de 500, se RETRY recupera, e se trecho MENOR reduz 500.
import { readFileSync } from 'node:fs';
const KEY = readFileSync('/tmp/gkey.txt', 'utf8').trim();
const MODEL = 'gemini-2.5-flash-preview-tts';
const URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(KEY)}`;

async function call(text) {
  const body = JSON.stringify({
    contents: [{ parts: [{ text }] }],
    generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } } } },
  });
  const ctrl = new AbortController();
  const tm = setTimeout(() => ctrl.abort(), 90000);
  const t0 = Date.now();
  let res;
  try { res = await fetch(URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: ctrl.signal }); }
  catch (e) { clearTimeout(tm); return { status: 'ERR', ms: Date.now() - t0, err: e.name === 'AbortError' ? 'ABORT' : String(e.message || e) }; }
  clearTimeout(tm);
  const ms = Date.now() - t0;
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    return { status: res.status, ms, err: j?.error?.message || ('HTTP ' + res.status), code: j?.error?.code, estatus: j?.error?.status };
  }
  const j = await res.json();
  const data = j?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  return { status: 200, ms, bytes: data ? Math.floor(data.length * 3 / 4) : 0, hasAudio: !!data };
}

// trecho realista ~800 chars com TÍTULO EM CAIXA ALTA (como o do usuário)
const chunk800 = `CONCLUSÕES PROVISÓRIAS. Toda a vida, inclusive a vida de um indivíduo humano, é um experimento contínuo em que a natureza e a história testam, sem pressa, quais formas conseguem persistir. Não existe um ponto final em que possamos dizer que tudo ficou compreendido; existe apenas a próxima pergunta, que nasce justamente da resposta anterior. Quando aceitamos essa condição provisória, deixamos de exigir certezas absolutas e passamos a valorizar a coerência, a honestidade e a disposição de revisar o que pensávamos saber. É nesse movimento humilde, e ao mesmo tempo corajoso, que o conhecimento avança e que a pessoa amadurece, aprendendo a conviver com a dúvida sem se paralisar diante dela, e encontrando, no próprio caminho, um sentido que não precisa ser eterno para ser verdadeiro.`.slice(0, 800);

console.log('chunk de', chunk800.length, 'chars\n');

console.log('== A) 6 chamadas seguidas (mede taxa de 500/erros) ==');
const stats = { 200: 0, 500: 0, other: 0 };
for (let i = 0; i < 6; i++) {
  const r = await call(chunk800);
  const tag = r.status === 200 ? `OK ${r.bytes}b` : `${r.status} ${r.estatus || ''} "${(r.err || '').slice(0, 60)}"`;
  console.log(`  #${i + 1}: ${r.ms}ms · ${tag}`);
  if (r.status === 200) stats[200]++; else if (r.status === 500) stats[500]++; else stats.other++;
  await new Promise((s) => setTimeout(s, 1500));
}
console.log(`  → 200:${stats[200]} 500:${stats[500]} outros:${stats.other}\n`);

console.log('== B) RETRY recupera de 500? (até 5 tentativas com backoff) ==');
async function callWithRetry(text, maxRetry = 5) {
  for (let a = 0; a <= maxRetry; a++) {
    const r = await call(text);
    if (r.status === 200) return { ...r, attempts: a + 1 };
    const retryable = r.status === 429 || (typeof r.status === 'number' && r.status >= 500) || r.status === 'ERR';
    console.log(`     tentativa ${a + 1}: ${r.status} ${r.estatus || ''} ${retryable ? '(retryable)' : '(fatal)'}`);
    if (!retryable) return { ...r, attempts: a + 1 };
    await new Promise((s) => setTimeout(s, Math.min(20000, 2000 * Math.pow(2, a))));
  }
  return { status: 'GAVE_UP', attempts: maxRetry + 1 };
}
for (let i = 0; i < 3; i++) {
  const r = await callWithRetry(chunk800);
  console.log(`  texto ${i + 1}: terminou em ${r.status === 200 ? 'OK' : r.status} após ${r.attempts} tentativa(s)`);
}

console.log('\n== C) trecho MENOR (~350 chars) tem menos 500? ==');
const chunk350 = chunk800.slice(0, 350);
const s2 = { 200: 0, 500: 0, other: 0 };
for (let i = 0; i < 6; i++) {
  const r = await call(chunk350);
  console.log(`  #${i + 1}: ${r.ms}ms · ${r.status === 200 ? 'OK' : r.status + ' ' + (r.estatus || '')}`);
  if (r.status === 200) s2[200]++; else if (r.status === 500) s2[500]++; else s2.other++;
  await new Promise((s) => setTimeout(s, 1500));
}
console.log(`  → 200:${s2[200]} 500:${s2[500]} outros:${s2.other}`);
