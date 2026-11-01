// Duração ISO 8601 → "mm min" / "h h mm min" — port fiel do youtube.py.

const ISO_DUR = /P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/;

export function isoDurationToHuman(iso: string): string {
  if (!iso) return '';
  const m = iso.match(ISO_DUR);
  if (!m) return '';
  const [days, hours, minutes, seconds] = m.slice(1).map((x) => (x ? parseInt(x, 10) : 0));
  const totalMin = days * 24 * 60 + hours * 60 + minutes + (seconds >= 30 ? 1 : 0);
  if (totalMin >= 60) {
    const h = Math.floor(totalMin / 60);
    const mm = totalMin % 60;
    return mm ? `${h} h ${String(mm).padStart(2, '0')} min` : `${h} h`;
  }
  return `${totalMin} min`;
}

export function msToTimestamp(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const mm = Math.floor(totalSec / 60);
  const ss = totalSec % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}
