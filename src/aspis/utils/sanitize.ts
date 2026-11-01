// Sanitização de nome de arquivo — port byte-a-byte do obsidian.py:_sanitize.
// Remove \ / : * ? " < > | # [ ] ^, colapsa espaços, corta em 80 chars.

export function sanitizeFilename(name: string, maxLen = 80): string {
  let out = (name || '').replace(/[\\/:*?"<>|#\[\]^]/g, '').trim();
  out = out.replace(/\s+/g, ' ');
  return out.slice(0, maxLen).trim() || 'sem-titulo';
}

export function noteBasename(neutralTitle: string, videoId: string): string {
  return `${sanitizeFilename(neutralTitle)} (${videoId})`;
}
