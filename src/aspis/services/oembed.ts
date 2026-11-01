// Metadados básicos via oEmbed — sem quota e sem autenticação.
// https://www.youtube.com/oembed?url=...&format=json

import { watchUrl } from '../utils/videoId';

export interface OEmbedInfo {
  title: string;
  channel: string;
  thumbnail: string;
}

export async function fetchOEmbed(videoId: string): Promise<OEmbedInfo | null> {
  try {
    const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl(videoId))}&format=json`;
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const data = await resp.json();
    return {
      title: data.title || '',
      channel: data.author_name || '',
      thumbnail: data.thumbnail_url || '',
    };
  } catch {
    return null;
  }
}
