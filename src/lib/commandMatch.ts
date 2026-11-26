/** Pure matching and ranking for the Ctrl/Cmd+K palette. No imports, so node:test can load it. */

export type CommandGroup = "Actions" | "Go to" | "Meetings" | "People";

export interface Command {
  id: string;
  label: string;
  group: CommandGroup;
  /** Extra words that should also find this command ("record" for Start recording). */
  keywords?: string;
  /** Small right-hand text (a date, an email). */
  hint?: string;
}

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").trim();

/**
 * 0 = no match. Higher is better: whole-text prefix (100), word prefix (80), substring (60), letters in order (30).
 * Every word of the query must match somewhere (words are scored independently and averaged down by the weakest).
 */
export function scoreText(query: string, text: string): number {
  const q = norm(query);
  const t = norm(text);
  if (!q) return 1;
  if (!t) return 0;
  let worst = 100;
  for (const w of q.split(/\s+/)) {
    let s = 0;
    if (t.startsWith(w)) s = 100;
    else if (t.split(/[\s\-_.@/]+/).some((x) => x.startsWith(w))) s = 80;
    else if (t.includes(w)) s = 60;
    else {
      let i = 0;
      for (const c of t) if (c === w[i]) i++;
      if (w.length >= 3 && i === w.length) s = 30;
    }
    if (s === 0) return 0;
    worst = Math.min(worst, s);
  }
  // A whole-query prefix beats word-level matches of the same strength.
  return t.startsWith(q) ? 100 : worst;
}

export function scoreCommand(query: string, c: Command): number {
  const label = scoreText(query, c.label);
  const extra = c.keywords ? Math.floor(scoreText(query, c.keywords) * 0.7) : 0;
  return Math.max(label, extra);
}

const GROUP_ORDER: Record<CommandGroup, number> = { Actions: 0, "Go to": 1, Meetings: 2, People: 3 };

/** With no query: the commands as given (Actions and Go to only). With one: best matches first, ties by group then input order. */
export function rankCommands(query: string, commands: Command[], limit = 12): Command[] {
  if (!query.trim()) return commands.filter((c) => c.group === "Actions" || c.group === "Go to").slice(0, limit);
  return commands
    .map((c, i) => ({ c, i, s: scoreCommand(query, c) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || GROUP_ORDER[a.c.group] - GROUP_ORDER[b.c.group] || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.c);
}

/** Next highlighted index when arrowing through `count` results (wraps). */
export function moveActive(current: number, delta: 1 | -1, count: number): number {
  if (count <= 0) return -1;
  return (current + delta + count) % count;
}
