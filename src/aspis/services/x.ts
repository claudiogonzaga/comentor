// O feed do X, lido com a sua própria sessão.
//
// O X não tem API gratuita. Como no Aspis do Mac, o caminho para um app pessoal é a
// sessão de quem usa: você entra na página oficial do X, dentro do app (a senha fica
// nela; o app só guarda os cookies, no próprio aparelho). Depois, uma página invisível
// abre a sua timeline e lê as mesmas respostas que o site recebe. Assim não depende de
// endereços internos do X, que mudam o tempo todo.

import { create } from 'zustand';

import * as db from './db';

export const X_LOGIN_URL = 'https://x.com/i/flow/login';
export const X_LOGOUT_URL = 'https://x.com/logout';
export const X_HOME_URL = 'https://x.com/home';
// O X recusa o WebView "puro": a página se apresenta como o Chrome do celular.
export const X_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';

const META_CONNECTED = 'x_connected';
const HARVEST_TIMEOUT_MS = 45_000;
const ENOUGH_POSTS = 40;

export interface XPost {
  id: string;
  text: string;
  name: string;
  handle: string;
  thumb: string;
  createdAt: string; // ISO
  likes: number;
  retweets: number;
  url: string;
}

/**
 * Injetado antes de a página carregar: observa as respostas da timeline, tira delas
 * os posts (sem anúncios nem o invólucro dos reposts) e manda para o app. Depois abre
 * a aba "Seguindo", a cronológica, e rola a página para carregar mais.
 */
export const HARVEST_JS = `(function(){
  function post(m){try{window.ReactNativeWebView.postMessage(JSON.stringify(m))}catch(e){}}
  var seen={};
  function walk(o,out){
    if(!o||typeof o!=='object')return;
    if(Array.isArray(o)){for(var i=0;i<o.length;i++)walk(o[i],out);return;}
    if(typeof o.entryId==='string'&&o.entryId.indexOf('promoted')===0)return;
    if(o.promotedMetadata)return;
    if(o.rest_id&&o.legacy&&typeof o.legacy.full_text==='string'&&!o.legacy.retweeted_status_result&&!seen[o.rest_id]){
      var u=o.core&&o.core.user_results&&o.core.user_results.result;
      var ul=(u&&u.legacy)||{};
      var core=(u&&u.core)||{};
      var handle=ul.screen_name||core.screen_name||'';
      var note=o.note_tweet&&o.note_tweet.note_tweet_results&&o.note_tweet.note_tweet_results.result&&o.note_tweet.note_tweet_results.result.text;
      if(handle){
        seen[o.rest_id]=1;
        out.push({id:o.rest_id,text:note||o.legacy.full_text,name:ul.name||core.name||handle,handle:handle,
          thumb:(ul.profile_image_url_https||(u&&u.avatar&&u.avatar.image_url)||'').replace('_normal','_400x400'),
          createdAt:new Date(o.legacy.created_at).toISOString(),likes:o.legacy.favorite_count||0,retweets:o.legacy.retweet_count||0,
          url:'https://x.com/'+handle+'/status/'+o.rest_id});
      }
    }
    for(var k in o){if(Object.prototype.hasOwnProperty.call(o,k))walk(o[k],out);}
  }
  function take(text){try{var out=[];walk(JSON.parse(text),out);if(out.length)post({type:'posts',posts:out});}catch(e){}}
  var isFeed=function(u){return /Home(Latest)?Timeline/.test(u||'')};
  var of=window.fetch;
  window.fetch=function(){var a=arguments;return of.apply(this,a).then(function(r){try{var u=(a[0]&&a[0].url)||String(a[0]);if(isFeed(u))r.clone().text().then(take);}catch(e){}return r;});};
  var oo=XMLHttpRequest.prototype.open,os=XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open=function(m,u){this.__u=u;return oo.apply(this,arguments)};
  XMLHttpRequest.prototype.send=function(){var x=this;x.addEventListener('load',function(){try{if(isFeed(x.__u))take(x.responseText)}catch(e){}});return os.apply(this,arguments)};
  var tries=0,clicked=false;
  var t=setInterval(function(){
    tries++;
    var path=location.pathname;
    if(path.indexOf('/i/flow/login')===0||path==='/login'||path==='/i/flow/signup'){post({type:'logged-out'});clearInterval(t);return;}
    var tabs=document.querySelectorAll('[role="tablist"] [role="tab"]');
    if(tabs.length>=2&&!clicked){clicked=true;tabs[1].click();}
    window.scrollBy(0,1400);
    if(tries>=20){post({type:'done'});clearInterval(t);}
  },1500);
})();true;`;

interface XState {
  connected: boolean;
  /** Pedido de leitura em curso: o XHarvester abre a página invisível. */
  harvesting: boolean;
  load: () => void;
  setConnected: (value: boolean) => void;
}

export const useXStore = create<XState>((set) => ({
  connected: false,
  harvesting: false,
  load: () => set({ connected: db.getMeta(META_CONNECTED) === '1' }),
  setConnected: (value) => {
    db.setMeta(META_CONNECTED, value ? '1' : '0');
    set({ connected: value });
  },
}));

export class XLoginRequired extends Error {
  constructor() {
    super('A sessão do X expirou. Conecte de novo.');
    this.name = 'XLoginRequired';
  }
}

let pending: { resolve: (posts: XPost[]) => void; reject: (e: Error) => void } | null = null;
let collected = new Map<string, XPost>();
let timer: ReturnType<typeof setTimeout> | null = null;

function finish(error?: Error): void {
  const job = pending;
  pending = null;
  if (timer) clearTimeout(timer);
  timer = null;
  useXStore.setState({ harvesting: false });
  if (!job) return;
  if (error) job.reject(error);
  else job.resolve(Array.from(collected.values()));
}

/** Abre a timeline numa página invisível e devolve os posts que apareceram. */
export function harvestTimeline(): Promise<XPost[]> {
  if (pending) return Promise.reject(new Error('O X já está sendo lido.'));
  collected = new Map();
  return new Promise<XPost[]>((resolve, reject) => {
    pending = { resolve, reject };
    useXStore.setState({ harvesting: true });
    timer = setTimeout(() => finish(), HARVEST_TIMEOUT_MS);
  });
}

/** O que a página invisível manda. */
export function onHarvestMessage(raw: string): void {
  let msg: { type?: string; posts?: XPost[] };
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }
  if (msg.type === 'posts') {
    for (const p of msg.posts ?? []) collected.set(p.id, p);
    if (collected.size >= ENOUGH_POSTS) finish();
  } else if (msg.type === 'logged-out') {
    useXStore.getState().setConnected(false);
    finish(new XLoginRequired());
  } else if (msg.type === 'done') {
    finish();
  }
}
