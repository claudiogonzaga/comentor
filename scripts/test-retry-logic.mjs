// Valida o fluxo de retry do fetchPcm (espelha geminiTTS.ts) com fetch mockado.
// Prova: 5xx/429/timeout/empty re-tentam e recuperam; 4xx é fatal; esgota após MAX_RETRIES.

const MAX_RETRIES = 6;
const isRetryableStatus = (s) => s === 429 || (s >= 500 && s < 600);
const retryDelayMs = () => 1; // acelera o teste (no app: 2s..30s)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class GeminiTTSError extends Error {}

// fetchPcm espelhando geminiTTS.ts, com `mockFetch` injetado.
async function fetchPcm(mockFetch, attempt = 0) {
  let res;
  try {
    res = await mockFetch(); // pode lançar p/ simular timeout/rede
  } catch (err) {
    if (attempt < MAX_RETRIES) {
      await sleep(retryDelayMs(attempt));
      return fetchPcm(mockFetch, attempt + 1);
    }
    throw new GeminiTTSError(`Gemini TTS: ${err.message}`);
  }
  if (isRetryableStatus(res.status) && attempt < MAX_RETRIES) {
    await sleep(retryDelayMs(attempt));
    return fetchPcm(mockFetch, attempt + 1);
  }
  if (!res.ok) {
    throw new GeminiTTSError(`Gemini TTS: ${res.errMsg || 'HTTP ' + res.status}`);
  }
  const audioBase64 = res.audio;
  if (!audioBase64) {
    if (attempt < MAX_RETRIES) {
      await sleep(retryDelayMs(attempt));
      return fetchPcm(mockFetch, attempt + 1);
    }
    throw new GeminiTTSError('Gemini TTS: resposta sem áudio');
  }
  return { audio: audioBase64, attempts: attempt + 1 };
}

// helper: cria um mockFetch que consome uma fila de respostas/erros
function queueFetch(items) {
  let i = 0;
  return async () => {
    const it = items[Math.min(i, items.length - 1)];
    i++;
    if (it.throw) throw new Error(it.throw);
    return {
      status: it.status,
      ok: it.status >= 200 && it.status < 300,
      audio: it.audio,
      errMsg: it.errMsg,
    };
  };
}

let pass = 0, fail = 0;
const ok = (c, n) => { c ? pass++ : fail++; console.log(`  ${c ? 'PASS' : 'FAIL'} ${n}`); };

console.log('Cenários de retry do fetchPcm:');

// 1) o bug do usuário: 500 → 500 → 200(áudio). Deve RECUPERAR.
let r = await fetchPcm(queueFetch([
  { status: 500, errMsg: 'An internal error has occurred. Please retry' },
  { status: 500, errMsg: 'An internal error has occurred. Please retry' },
  { status: 200, audio: 'QUJD' },
])).catch((e) => ({ error: e.message }));
ok(r.audio === 'QUJD' && r.attempts === 3, `500→500→200 recupera (áudio na 3ª tentativa) [${JSON.stringify(r)}]`);

// 2) 503 → 200
r = await fetchPcm(queueFetch([{ status: 503 }, { status: 200, audio: 'QQ' }])).catch((e) => ({ error: e.message }));
ok(r.audio === 'QQ' && r.attempts === 2, `503→200 recupera`);

// 3) 429 → 200
r = await fetchPcm(queueFetch([{ status: 429 }, { status: 200, audio: 'QQ' }])).catch((e) => ({ error: e.message }));
ok(r.audio === 'QQ' && r.attempts === 2, `429→200 recupera`);

// 4) timeout/rede → 200
r = await fetchPcm(queueFetch([{ throw: 'Aborted' }, { status: 200, audio: 'QQ' }])).catch((e) => ({ error: e.message }));
ok(r.audio === 'QQ' && r.attempts === 2, `timeout→200 recupera`);

// 5) 200 SEM áudio → 200 com áudio
r = await fetchPcm(queueFetch([{ status: 200, audio: undefined }, { status: 200, audio: 'QQ' }])).catch((e) => ({ error: e.message }));
ok(r.audio === 'QQ' && r.attempts === 2, `200-vazio→200-áudio recupera`);

// 6) 401 (chave inválida) é FATAL — NÃO re-tenta
let attempts401 = 0;
r = await fetchPcm(async () => { attempts401++; return { status: 401, ok: false, errMsg: 'API key invalid' }; }).catch((e) => ({ error: e.message }));
ok(!!r.error && attempts401 === 1, `401 é fatal, sem retry (1 tentativa)`);

// 7) 500 persistente esgota após MAX_RETRIES+1 tentativas e então lança
let attempts500 = 0;
r = await fetchPcm(async () => { attempts500++; return { status: 500, ok: false, errMsg: 'internal' }; }).catch((e) => ({ error: e.message }));
ok(!!r.error && attempts500 === MAX_RETRIES + 1, `500 persistente: ${attempts500} tentativas então falha (esperado ${MAX_RETRIES + 1})`);

// 8) leitura de 24 trechos com 12% de chance de 500 por chamada: SEM retry vs COM retry
function simulate(withRetry, chunks = 24, pFail = 0.12, seed = 1) {
  // RNG determinístico (sem Math.random p/ reprodutibilidade)
  let s = seed;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  let okChunks = 0;
  for (let c = 0; c < chunks; c++) {
    let tries = withRetry ? MAX_RETRIES + 1 : 1;
    let good = false;
    for (let t = 0; t < tries; t++) { if (rnd() >= pFail) { good = true; break; } }
    if (good) okChunks++;
  }
  return okChunks === chunks; // leitura inteira só passa se TODOS os trechos passam
}
let semRetry = 0, comRetry = 0;
for (let seed = 1; seed <= 200; seed++) { if (simulate(false, 24, 0.12, seed)) semRetry++; if (simulate(true, 24, 0.12, seed)) comRetry++; }
console.log(`\n  Simulação 200 leituras de 24 trechos (12% de 500 por chamada):`);
console.log(`    SEM retry: ${semRetry}/200 leituras completas (${Math.round(semRetry / 2)}%)`);
console.log(`    COM retry: ${comRetry}/200 leituras completas (${Math.round(comRetry / 2)}%)`);
ok(comRetry >= 198 && semRetry <= 100, `retry transforma ~${Math.round(semRetry/2)}% → ~${Math.round(comRetry/2)}% de sucesso`);

console.log(`\nRESULTADO: ${pass} passaram, ${fail} falharam`);
process.exit(fail === 0 ? 0 : 1);
