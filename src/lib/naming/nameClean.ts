// Turns raw OCR text from a tile's name label into a usable person name, and matches it against the people
// we expect (plan attendees, the People directory). Pure, no imports, erasable TypeScript only.

export interface CleanName {
  /** The cleaned name as read (not yet matched to anyone). */
  name: string;
  /** The label was cut short ("Priyanka Sh…"), so only a prefix was read. */
  truncated: boolean;
}

/** Words that mean the label is a device or room, not a person. */
const DEVICE_WORDS =
  /\b(iphone|ipad|ipod|galaxy|pixel|android|oneplus|redmi|xiaomi|oppo|vivo|realme|samsung|macbook|laptop|desktop|tablet|conference|conf|room|boardroom|meeting|phone|dial|dialin|dial-in|guest|unknown|participant|user|admin|host|organi[sz]er|tv|display|whiteboard|surface|chromebook|windows|pc)\b/i;

/** Words that mean the OCR read the call's own buttons or status text. */
const UI_WORDS =
  /\b(mute|muted|unmute|camera|microphone|mic|participants?|recording|joining|waiting|present(?:ing|ation)?|screen|captions?|raise|hand|pin|pinned|more|options|reactions?|chat|people|share|leave|end|call|live|you)\b/i;

/** Names are data that end up in AI prompts: a person's name is never an instruction. */
const INSTRUCTION_WORDS = /\b(ignore|disregard|forget|override|instructions?|system|prompts?|assistant|developer|jailbreak|output)\b/i;

const MAX_WORDS = 3;
const MAX_LEN = 30;

/** Common OCR mix-ups inside a word: 0 -> o, 1 -> l, 5 -> s, 8 -> b (only when letters surround them). */
function fixDigits(word: string): string {
  if (!/\d/.test(word) || (word.match(/\p{L}/gu) ?? []).length < 2) return word;
  return word.replace(/0/g, "o").replace(/1/g, "l").replace(/5/g, "s").replace(/8/g, "b");
}

/** Removes parentheses, presenting / host / you markers, icons and junk. Returns null when nothing name-like is left. */
export function cleanName(raw: string | null | undefined): CleanName | null {
  if (!raw) return null;
  let s = String(raw).normalize("NFC").replace(/[\r\n\t]+/g, " ");
  const truncated = /(?:…|\.{2,})\s*$/.test(s.trim());
  // (Host) (You) (Presenting) [Guest] {..}
  s = s.replace(/\([^)]*\)|\[[^\]]*\]|\{[^}]*\}/g, " ");
  // "Priya Nair - Host", "Priya Nair | Guest", "Priya Nair • Presenting": keep the part before the separator.
  s = s.split(/\s[-|–—•·]\s|[|•·]/)[0] ?? "";
  s = s.replace(/\bis\s+presenting\b/gi, " ").replace(/\bpresenting\b/gi, " ");
  // Anything that is not a letter, mark, space, apostrophe, dot or hyphen (digits are fixed up per word below).
  s = s.replace(/[^\p{L}\p{M}\d\s'’.\-]/gu, " ");
  const words = s
    .split(/\s+/)
    .map((w) => fixDigits(w).replace(/^[.\-']+|[.\-']+$/g, "").replace(/\d/g, ""))
    .filter(Boolean);
  if (words.length === 0 || words.length > MAX_WORDS) return null;
  const name = words.join(" ");
  const letters = name.replace(/[^\p{L}]/gu, "");
  if (letters.length < 2 || name.length > MAX_LEN) return null;
  if (DEVICE_WORDS.test(name) || UI_WORDS.test(name) || INSTRUCTION_WORDS.test(name)) return null;
  // Names are not made of single letters ("i l t", "A B"). One initial next to a real word ("Rahul K") is fine.
  const singles = words.filter((w) => w.replace(/[^\p{L}]/gu, "").length === 1).length;
  if (singles >= 2 || singles === words.length) return null;
  // Cased scripts: a name starts with a capital letter (OCR junk is often lower case).
  const first = words[0].replace(/[^\p{L}]/gu, "");
  const cased = first.toLowerCase() !== first.toUpperCase();
  if (cased && first[0] !== first[0].toUpperCase()) return null;
  // Every word with 3+ letters needs a vowel-ish letter; consonant strings are junk (not for non-Latin scripts).
  for (const w of words) {
    const l = w.replace(/[^\p{L}]/gu, "");
    if (/^[A-Za-z]+$/.test(l) && l.length >= 3 && !/[aeiouyAEIOUY]/.test(l)) return null;
  }
  return { name, truncated };
}

/** Lower case, accents removed, only letters and single spaces: the comparison form of a name. */
export function normKey(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

function similarity(a: string, b: string): number {
  const m = Math.max(a.length, b.length);
  return m === 0 ? 1 : 1 - levenshtein(a, b) / m;
}

function sortedTokens(k: string): string {
  return k.split(" ").sort().join(" ");
}

export interface RosterMatch {
  /** The roster's own spelling. */
  name: string;
  score: number;
}

export const ROSTER_THRESHOLD = 0.8;

/** Names shorter than this (letters only) must match exactly: "Amit" is not "Amita", "Ravi" is not "Ravina". */
export const MIN_FUZZY_LETTERS = 5;

const letterCount = (k: string) => k.replace(/ /g, "").length;

function scoreAgainst(cand: string, truncated: boolean, rosterKey: string, firstNameOnly: boolean): number {
  const exact = cand === rosterKey || sortedTokens(cand) === sortedTokens(rosterKey);
  let best = 0;
  if (exact) best = 1;
  else if (Math.min(letterCount(cand), letterCount(rosterKey)) >= MIN_FUZZY_LETTERS) {
    best = Math.max(similarity(cand, rosterKey), similarity(sortedTokens(cand), sortedTokens(rosterKey)));
  }
  const ct = cand.split(" ");
  const rt = rosterKey.split(" ");
  // A first name alone ("Priya") for "Priya Nair": only where allowed, and only when nobody else in the roster has that first name.
  if (firstNameOnly && ct.length === 1 && rt.length > 1) {
    const s = similarity(ct[0], rt[0]);
    if (ct[0] === rt[0] || (Math.min(ct[0].length, rt[0].length) >= MIN_FUZZY_LETTERS && s >= 0.85)) best = Math.max(best, 0.85 * s + 0.1);
  }
  // A cut-off label ("priyanka sh") is the start of the full name (the part before the cut must be a real stretch of it).
  const stem = cand.replace(/\s+\S{0,2}$/, "");
  if (truncated && stem.length >= MIN_FUZZY_LETTERS && rosterKey.startsWith(stem)) best = Math.max(best, 0.9);
  return best;
}

/**
 * The roster entry this name is (the roster spelling is used so "Rahul Sharma" and "rahul sharrna" collapse),
 * or null. When two different people fit equally well the answer is null: better no name than a wrong one.
 */
export function matchRoster(
  candidate: string,
  roster: ReadonlyArray<string>,
  truncated = false,
  threshold = ROSTER_THRESHOLD,
  /** Allow "Priya" to stand for "Priya Nair" (only when that first name is unique in the roster). */
  allowFirstName = true,
): RosterMatch | null {
  const cand = normKey(candidate);
  if (!cand) return null;
  const firstOf = (k: string) => k.split(" ")[0];
  const keys = [...new Set(roster.map(normKey).filter(Boolean))];
  const sameFirst = cand.includes(" ") ? 0 : keys.filter((k) => k.includes(" ") && similarity(firstOf(cand), firstOf(k)) >= 0.85).length;
  const firstNameOnly = allowFirstName && sameFirst === 1;
  const scored: Array<{ name: string; key: string; score: number }> = [];
  const seen = new Set<string>();
  for (const r of roster) {
    const key = normKey(r);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    scored.push({ name: r.trim(), key, score: scoreAgainst(cand, truncated, key, firstNameOnly) });
  }
  scored.sort((a, b) => b.score - a.score);
  const top = scored[0];
  if (!top || top.score < threshold) return null;
  const next = scored[1];
  if (next && next.score >= threshold && top.score - next.score < 0.04) return null;
  return { name: top.name, score: top.score };
}

export interface ResolvedName {
  name: string;
  /** The name matched somebody we expected in the meeting. */
  roster: boolean;
}

/** Clean a raw label and match it to the roster. Null when the label is not a plausible name. */
export function resolveName(raw: string | null | undefined, roster: ReadonlyArray<string>): ResolvedName | null {
  const c = cleanName(raw);
  if (!c) return null;
  const m = matchRoster(c.name, roster, c.truncated);
  if (m) return { name: m.name, roster: true };
  if (c.truncated) return null; // a cut-off name nobody expected is not worth keeping
  return { name: c.name, roster: false };
}

/** The directory is large, so a match against it must be nearly exact; plan attendees get the normal bar. */
export const DIRECTORY_THRESHOLD = 0.92;

/**
 * Like resolveName, with two lists: the plan's attendees (people we expect in this very meeting) and the
 * People directory. A name from either list counts as "expected" and is written with the list's spelling.
 */
export function resolveWithRosters(
  raw: string | null | undefined,
  attendees: ReadonlyArray<string>,
  directory: ReadonlyArray<string>,
): ResolvedName | null {
  const c = cleanName(raw);
  if (!c) return null;
  const a = matchRoster(c.name, attendees, c.truncated);
  if (a) return { name: a.name, roster: true };
  const d = matchRoster(c.name, directory, c.truncated, DIRECTORY_THRESHOLD, false);
  if (d) return { name: d.name, roster: true };
  if (c.truncated) return null;
  return { name: c.name, roster: false };
}
