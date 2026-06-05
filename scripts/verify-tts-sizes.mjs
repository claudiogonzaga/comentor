// Mede tempo de geração do Gemini TTS por TAMANHO de trecho, com PROSA VARIADA
// (não repetida) — pra achar o tamanho de chunk que gera dentro do timeout.
import { readFileSync, writeFileSync } from 'node:fs';
const KEY = readFileSync('/tmp/gkey.txt', 'utf8').trim();
const TTS_MODEL = 'gemini-2.5-flash-preview-tts';
const URL = `https://generativelanguage.googleapis.com/v1beta/models/${TTS_MODEL}:generateContent?key=${encodeURIComponent(KEY)}`;
const SR = 24000, TIMEOUT = 120000;

const B64 = (() => { const c='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; const t=new Int8Array(256).fill(-1); for(let i=0;i<c.length;i++)t[c.charCodeAt(i)]=i; t[45]=62;t[95]=63; return t;})();
function dec(b){let n=0;for(let i=0;i<b.length;i++)if(B64[b.charCodeAt(i)&0xff]>=0)n++;const o=new Uint8Array(Math.floor(n*3/4));let a=0,k=0,p=0;for(let i=0;i<b.length;i++){const v=B64[b.charCodeAt(i)&0xff];if(v<0)continue;a=(a<<6)|v;k+=6;if(k>=8){k-=8;o[p++]=(a>>k)&0xff;}}return o;}

// ~1200 chars de prosa variada em pt-BR (sem repetição)
const PROSE = `Bom dia. Hoje é um bom momento para começar com calma e atenção ao que importa de verdade. Antes de abrir o computador, respire fundo três vezes e perceba como o corpo responde a esse pequeno cuidado. Beba um copo de água, ajuste a postura na cadeira e lembre que pequenas pausas ao longo do dia ajudam a manter a energia. Se bater aquela vontade de resolver tudo de uma vez, escolha apenas a próxima tarefa e dê o primeiro passo. O resto vem depois, sem pressa. Quando o cansaço aparecer, levante, caminhe um pouco pela casa e olhe para longe da tela por alguns segundos. Seus olhos e suas costas agradecem. À tarde, vale comer algo leve e voltar com a mente mais clara para as decisões que ficaram pendentes. No fim do dia, anote uma coisa boa que aconteceu, por menor que seja, e reconheça o esforço que você fez. Dormir bem é parte do trabalho, não o oposto dele. Desligue as telas mais cedo, deixe o quarto escuro e silencioso, e permita que o sono chegue naturalmente. Amanhã será uma nova chance de cuidar de você com gentileza e constância ao longo de toda a jornada.`;

async function call(text){
  const body=JSON.stringify({contents:[{parts:[{text}]}],generationConfig:{responseModalities:['AUDIO'],speechConfig:{voiceConfig:{prebuiltVoiceConfig:{voiceName:'Aoede'}}}}});
  const ctrl=new AbortController(); const tm=setTimeout(()=>ctrl.abort(),TIMEOUT); const t0=Date.now();
  let res; try{ res=await fetch(URL,{method:'POST',headers:{'Content-Type':'application/json'},body,signal:ctrl.signal}); }
  catch(e){ clearTimeout(tm); return {ok:false,ms:Date.now()-t0,err:e.name==='AbortError'?'ABORTED':String(e.message||e)};}
  clearTimeout(tm); const ms=Date.now()-t0;
  if(!res.ok){const j=await res.json().catch(()=>({}));return{ok:false,ms,status:res.status,err:j?.error?.message||('HTTP '+res.status)};}
  const j=await res.json(); const d=j?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if(!d)return{ok:false,ms,err:'sem áudio'};
  const pcm=dec(d); return {ok:true,ms,pcm,dur:pcm.length/2/SR};
}

const sizes=[200,350,500,650,800];
console.log('tamanho | tempo de geração | áudio gerado | status');
console.log('--------|------------------|--------------|-------');
const rows=[];
for(const n of sizes){
  // corta em fronteira de espaço pra não quebrar palavra
  let t=PROSE.slice(0,n); const sp=t.lastIndexOf(' '); if(sp>n-20)t=t.slice(0,sp);
  const r=await call(t);
  if(r.ok){ console.log(`${String(t.length).padStart(7)} | ${String(r.ms+'ms').padStart(16)} | ${r.dur.toFixed(1)+'s'.padStart(11)} | OK`); rows.push({n:t.length,ms:r.ms,dur:r.dur}); }
  else { console.log(`${String(t.length).padStart(7)} | ${String(r.ms+'ms').padStart(16)} | ${''.padStart(12)} | FALHOU: ${r.err}`); rows.push({n:t.length,ms:r.ms,fail:r.err}); }
}
console.log('\nRESUMO: maior trecho que gerou < 90s =',
  Math.max(0,...rows.filter(r=>!r.fail && r.ms<90000).map(r=>r.n)), 'chars');
