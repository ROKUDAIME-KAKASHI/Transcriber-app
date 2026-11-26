/** In-transcript search: pure and client-side. No imports, so node:test can load it. */

const norm = (s: string) => s.trim().toLowerCase();

/** True when the text contains the query (case-insensitive). An empty query matches everything. */
export function matchesQuery(text: string, query: string): boolean {
  const q = norm(query);
  return q === "" || text.toLowerCase().includes(q);
}

export interface Segment {
  text: string;
  hit: boolean;
}

/** The text cut into pieces, with the query occurrences flagged for highlighting. Joined, the pieces equal the text. */
export function highlightSegments(text: string, query: string): Segment[] {
  const q = norm(query);
  if (!q) return [{ text, hit: false }];
  const lower = text.toLowerCase();
  // toLowerCase can change length for a few characters; fall back to plain text rather than mis-cut.
  if (lower.length !== text.length) return [{ text, hit: false }];
  const out: Segment[] = [];
  let at = 0;
  for (let i = lower.indexOf(q); i >= 0; i = lower.indexOf(q, at)) {
    if (i > at) out.push({ text: text.slice(at, i), hit: false });
    out.push({ text: text.slice(i, i + q.length), hit: true });
    at = i + q.length;
  }
  if (at < text.length) out.push({ text: text.slice(at), hit: false });
  return out.length ? out : [{ text, hit: false }];
}
