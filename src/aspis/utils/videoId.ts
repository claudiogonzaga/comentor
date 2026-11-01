// Extrai o videoId de qualquer forma de link do YouTube que chegue pelo
// menu Compartilhar: watch?v=, youtu.be/, shorts/, embed/, live/, com
// parâmetros extras (&t=90s, ?si=..., etc.) e texto ao redor.

const ID = '([A-Za-z0-9_-]{11})';

const PATTERNS = [
  new RegExp(`(?:youtube\\.com|youtube-nocookie\\.com|music\\.youtube\\.com)/watch\\?[^#\\s]*?[?&]?v=${ID}`),
  new RegExp(`youtu\\.be/${ID}`),
  new RegExp(`youtube\\.com/shorts/${ID}`),
  new RegExp(`youtube\\.com/live/${ID}`),
  new RegExp(`youtube\\.com/(?:embed|v)/${ID}`),
  new RegExp(`youtube\\.com/attribution_link\\?[^#\\s]*?v(?:%3D|=)${ID}`),
];

export function extractVideoId(shared: string): string | null {
  const text = (shared || '').trim();
  if (!text) return null;
  // O share do YouTube costuma mandar "Título https://youtu.be/XXXX" — isole a URL.
  const urlMatch = text.match(/https?:\/\/\S+/);
  const candidate = urlMatch ? urlMatch[0] : text;
  for (const re of PATTERNS) {
    const m = candidate.match(re);
    if (m) return m[1];
  }
  // Último recurso: o texto é só o ID?
  if (/^[A-Za-z0-9_-]{11}$/.test(candidate)) return candidate;
  return null;
}

export function watchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}
