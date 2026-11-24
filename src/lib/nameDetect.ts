// Pure speaker-name suggestion logic (no React, no network). Imported by tests with node's type
// stripping, so only relative value imports (with .ts) and type-only "@/" imports are allowed here.
import type { SpeakerNames, TranscriptPart } from "./transcript.ts";

export type NameConfidence = "high" | "medium";

export interface NameSuggestion {
  /** 0-based speaker number, the same key space as SpeakerNames. */
  speaker: number;
  /** Display form, at most 40 characters (the rename path clips to 40). */
  name: string;
  confidence: NameConfidence;
  source: "device" | "ai";
  /** The phrase that shows the name (clipped to about 120 characters). */
  evidence: string;
  /** Seconds into the meeting, when known. */
  t?: number;
}

/** One transcript line sent to /api/speaker-names. `s` is the 0-based speaker number. */
export interface NameLine {
  s: number;
  t?: number;
  text: string;
}

export interface SpeakerNamesRequest {
  lines: NameLine[];
  /** Speakers that already have a name, keyed by 0-based number. */
  named?: Record<string, string>;
  model?: "glm" | "haiku";
}

export interface SpeakerNamesResponse {
  suggestions: NameSuggestion[];
  error?: string;
}

const MAX_NAME = 40;
const EARLY_SECONDS = 600;
const EARLY_PARTS_NO_TIME = 60;

// ---------------------------------------------------------------- guards

const STOP = new Set(
  (
    "sure going not sorry fine glad happy here just back done ready trying looking sharing joining " +
    "presenting speaking muted afraid late new also still the a an in on at with everyone guys team " +
    "sir madam okay ok yes no hello hi hey thanks thank good great really very so but and or if what " +
    "who how when where why this that it he she they we you me my our your there then now today " +
    "going gonna want wanted need needed have has had will would can could should may might must " +
    "actually basically totally definitely probably maybe perhaps let sitting standing waiting " +
    "listening hearing using having getting taking making doing being coming leaving working " +
    "bhi to toh ye woh aap hum haan nahi accha achha theek abhi kya busy free ek bas ab phir " +
    "ठीक खुश तैयार यहाँ यहां सहमत बिज़ी श्योर भी तो अभी हाँ नहीं अच्छा बस और आप हम"
  ).split(/\s+/)
);
const GREETING = new Set(["hi", "hello", "hey", "okay", "ok"]);
const CALENDAR = new Set(
  (
    "monday tuesday wednesday thursday friday saturday sunday january february march april may june " +
    "july august september october november december"
  ).split(" ")
);

function isDevanagari(s: string): boolean {
  return /[ऀ-ॿ]/.test(s);
}

function titleCase(s: string): string {
  return s.replace(/(^|[\s'’-])(\p{L})/gu, (_m, a: string, b: string) => a + b.toLocaleUpperCase());
}

/** Clean a captured name and apply the guards. Returns null when it should be rejected. */
function cleanName(raw: string, titleize: boolean): string | null {
  let tokens = raw.trim().split(/\s+/).filter(Boolean);
  while (tokens.length && GREETING.has(tokens[0].toLocaleLowerCase())) tokens.shift();
  while (tokens.length && STOP.has(tokens[tokens.length - 1].toLocaleLowerCase())) tokens.pop();
  tokens = tokens.slice(0, 2);
  if (!tokens.length) return null;
  const first = tokens[0].toLocaleLowerCase();
  if (STOP.has(first) || CALENDAR.has(first)) return null;
  let name = tokens.join(" ");
  if (/\d/.test(name)) return null;
  if (tokens.some((t) => t.length > 25)) return null;
  if (name.length > MAX_NAME) return null;
  if (/^\p{Lu}{2,4}$/u.test(name)) return null; // acronyms
  if (titleize && !isDevanagari(name)) name = titleCase(name);
  return name;
}

// ---------------------------------------------------------------- patterns

const LN = String.raw`\p{Lu}[\p{L}\p{M}'’-]{1,24}(?:\s+\p{Lu}[\p{L}\p{M}'’-]{1,24})?(?![\p{L}\p{M}\d])`;
const LOOSE = String.raw`\p{L}[\p{L}\p{M}'’-]{1,24}(?:\s+\p{L}[\p{L}\p{M}'’-]{1,24})?(?![\p{L}\p{M}\d])`;
const ONE = String.raw`\p{L}[\p{L}\p{M}'’-]{1,24}(?![\p{L}\p{M}\d])`;
const DN = String.raw`[\u0900-\u097F]{2,20}(?:\s+[\u0900-\u097F]{2,20})?`;
const DSEP = String.raw`(?=$|[\s,.!?।])`;
const DSTART = String.raw`(?:^|[\s,.!?।])`;

interface Pattern {
  re: RegExp;
  weight: number;
  titleize: boolean;
}

const PATTERNS: Pattern[] = [
  { re: new RegExp(`[Mm]y [Nn]ame(?:'s|’s| is) (${LN})`, "gu"), weight: 0.95, titleize: false },
  { re: new RegExp(`\\b(?:I'm|I’m|I am) (${LN})`, "gu"), weight: 0.7, titleize: false },
  {
    re: new RegExp(`(?:[Tt]his is|[Ii]t's|[Ii]t’s) (${LN})(?=[\\s,.]+(?:here|speaking|from|joining|on the line)\\b)`, "gu"),
    weight: 0.85,
    titleize: false,
  },
  { re: new RegExp(`^\\W*(?:(?:[Hh]i|[Hh]ello|[Hh]ey)\\W+)?[Tt]his is (${LN})\\W*$`, "gu"), weight: 0.5, titleize: false },
  {
    re: new RegExp(`(?:^|[,.!?]\\s+|\\b(?:[Hh]i|[Hh]ello|[Hh]ey|[Oo]kay|[Oo]k)[,\\s]+)(${LN})[,\\s]+(?:here|speaking)\\b`, "gu"),
    weight: 0.8,
    titleize: false,
  },
  { re: new RegExp(`\\bmera naam (${LOOSE})\\s+(?:hai|he|h)\\b`, "giu"), weight: 0.95, titleize: true },
  { re: new RegExp(`\\b(?:main|mai|mein) (${ONE}) bol (?:raha|rahi|rha|rhi)\\b`, "giu"), weight: 0.85, titleize: true },
  { re: new RegExp(`\\b(?:main|mai|mein) (${ONE}) (?:hoon|hun|hu)\\b`, "giu"), weight: 0.5, titleize: true },
  { re: new RegExp(`मेरा नाम (${DN}) (?:है|हैं)${DSEP}`, "gu"), weight: 0.95, titleize: false },
  { re: new RegExp(`${DSTART}मैं (${DN}) (?:बोल रहा|बोल रही)${DSEP}`, "gu"), weight: 0.85, titleize: false },
  { re: new RegExp(`${DSTART}मैं (${DN}) (?:हूँ|हूं)${DSEP}`, "gu"), weight: 0.45, titleize: false },
];

const PREFILTER = /name|naam|i'?m\b|i’m|i am|this is|it'?s|it’s|here|speaking|bol r|hoon|hun\b|नाम|मैं/i;
const ADDRESS_RE = new RegExp(
  `\\b(?:[Tt]hanks|[Tt]hank you|[Hh]i|[Hh]ello|[Hh]ey|[Oo]ver to(?: you)?|[Gg]o ahead),?\\s+(\\p{Lu}[\\p{L}\\p{M}'’-]+)(?![,\\s]+(?:here|speaking)\\b)`,
  "gu"
);

const MIN_SCORE = 0.6;
const HIGH_SCORE = 0.9;

function key(name: string): string {
  return name.toLocaleLowerCase();
}

function clipEvidence(text: string, index: number): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= 120) return t;
  const start = Math.max(0, Math.min(index - 40, t.length - 120));
  return (start > 0 ? "…" : "") + t.slice(start, start + 120) + (start + 120 < t.length ? "…" : "");
}

interface Cand {
  name: string;
  score: number;
  hits: number;
  evidence: string;
  evWeight: number;
  t?: number;
}

/**
 * Finds self-introductions ("I'm Priya", "my name is Rahul", "mera naam ... hai", "मेरा नाम ... है")
 * and returns at most one suggested name per speaker. Works offline; never applies anything.
 */
export function detectSelfIntroductions(parts: TranscriptPart[], opts: { names?: SpeakerNames } = {}): NameSuggestion[] {
  const speakers = new Set(parts.map((p) => p.speaker));
  if (speakers.size < 2) return [];
  const names = opts.names;
  const named = (n: number) => !!names?.[String(n)]?.trim();
  const usedByOthers = new Map<string, number>();
  for (const n of speakers) {
    const v = names?.[String(n)]?.trim();
    if (v) usedByOthers.set(key(v), n);
  }

  const cands = new Map<number, Map<string, Cand>>();
  const addressed = new Map<number, Set<string>>();

  parts.forEach((p, idx) => {
    if (named(p.speaker)) return;
    const text = (p.text ?? "").normalize("NFC");
    if (!text || !PREFILTER.test(text)) {
      // Cheap negative guard still needs the address cues, which the prefilter doesn't cover.
      if (!/thank|hi|hello|hey|over to|go ahead/i.test(text)) return;
    }
    for (const m of text.matchAll(ADDRESS_RE)) {
      const set = addressed.get(p.speaker) ?? new Set<string>();
      set.add(key(m[1]));
      addressed.set(p.speaker, set);
    }
    if (!PREFILTER.test(text)) return;
    const early = typeof p.t === "number" ? p.t <= EARLY_SECONDS : idx < EARLY_PARTS_NO_TIME;
    const factor = early ? 1 : 0.6;
    for (const pat of PATTERNS) {
      pat.re.lastIndex = 0;
      for (const m of text.matchAll(pat.re)) {
        const name = cleanName(m[1], pat.titleize);
        if (!name) continue;
        const k = key(name);
        const owner = usedByOthers.get(k);
        if (owner !== undefined && owner !== p.speaker) continue;
        const bySpeaker = cands.get(p.speaker) ?? new Map<string, Cand>();
        cands.set(p.speaker, bySpeaker);
        const c = bySpeaker.get(k) ?? { name, score: 0, hits: 0, evidence: "", evWeight: -1 };
        bySpeaker.set(k, c);
        if (c.hits >= 2) continue;
        c.hits += 1;
        c.score += pat.weight * factor;
        if (pat.weight > c.evWeight) {
          c.evWeight = pat.weight;
          c.evidence = clipEvidence(text, m.index ?? 0);
          c.t = p.t;
        }
      }
    }
  });

  // Candidate lists per speaker, best first, dropping low scores and names the speaker addressed.
  const lists = new Map<number, Array<[string, Cand]>>();
  for (const [speaker, byKey] of cands) {
    const addr = addressed.get(speaker);
    const list = [...byKey.entries()]
      .filter(([k, c]) => c.score >= MIN_SCORE && !(addr && (addr.has(k) || addr.has(k.split(/\s+/)[0]))))
      .sort((a, b) => b[1].score - a[1].score);
    if (list.length) lists.set(speaker, list);
  }

  // One name per speaker; the same name for two speakers goes to the higher score (a tie drops both).
  for (let guard = 0; guard < 100; guard++) {
    const tops = new Map<string, number[]>();
    for (const [speaker, list] of lists) {
      const k = list[0][0];
      tops.set(k, [...(tops.get(k) ?? []), speaker]);
    }
    let changed = false;
    for (const [k, who] of tops) {
      if (who.length < 2) continue;
      const best = Math.max(...who.map((s) => lists.get(s)![0][1].score));
      const winners = who.filter((s) => lists.get(s)![0][1].score === best);
      const drop = winners.length > 1 ? who : who.filter((s) => !winners.includes(s));
      for (const s of drop) {
        const rest = lists.get(s)!.filter(([kk]) => kk !== k);
        if (rest.length) lists.set(s, rest);
        else lists.delete(s);
      }
      changed = true;
    }
    if (!changed) break;
  }

  const out: NameSuggestion[] = [];
  for (const [speaker, list] of lists) {
    const [, c] = list[0];
    out.push({
      speaker,
      name: c.name.slice(0, MAX_NAME),
      confidence: c.score >= HIGH_SCORE ? "high" : "medium",
      source: "device",
      evidence: c.evidence,
      t: c.t,
    });
  }
  return out.sort((a, b) => a.speaker - b.speaker);
}

// ---------------------------------------------------------------- AI request / response

const CUE_RE = /thanks|thank you|hello|\bhi\b|over to|go ahead|\bji\b|जी|नमस्ते/i;

/**
 * Picks a bounded set of lines for the AI: the first ten minutes, then any later line that looks like
 * an introduction or a greeting/address (plus the reply after it). `hintNames` are names found
 * on-device; lines that mention them are kept too.
 */
export function buildNameExcerpt(
  parts: TranscriptPart[],
  opts: { maxChars?: number; maxLines?: number; hintNames?: string[] } = {}
): NameLine[] {
  const maxChars = opts.maxChars ?? 14_000;
  const maxLines = opts.maxLines ?? 400;
  const hints = (opts.hintNames ?? []).map((h) => h.toLocaleLowerCase()).filter(Boolean);
  const picked = new Set<number>();
  let chars = 0;
  const take = (i: number, budget: number): boolean => {
    if (picked.has(i)) return true;
    const p = parts[i];
    if (!p || p.speaker < 0 || p.speaker > 49 || !p.text?.trim()) return true;
    const len = Math.min(p.text.length, 300);
    if (picked.size >= maxLines || chars + len > budget) return false;
    picked.add(i);
    chars += len;
    return true;
  };
  const earlyBudget = Math.floor(maxChars * 0.6);
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const early = typeof p.t === "number" ? p.t <= EARLY_SECONDS : i < 80;
    if (early && !take(i, earlyBudget)) break;
  }
  for (let i = 0; i < parts.length; i++) {
    if (picked.has(i)) continue;
    const text = parts[i].text ?? "";
    const lower = text.toLocaleLowerCase();
    if (PREFILTER.test(text) || CUE_RE.test(text) || hints.some((h) => lower.includes(h))) {
      if (!take(i, maxChars)) break;
      if (i + 1 < parts.length && !take(i + 1, maxChars)) break;
    }
  }
  return [...picked]
    .sort((a, b) => a - b)
    .map((i) => {
      const p = parts[i];
      const line: NameLine = { s: p.speaker, text: p.text.trim().slice(0, 300) };
      if (typeof p.t === "number") line.t = p.t;
      return line;
    });
}

/** Pull the first JSON object out of a model reply and return its raw suggestion list (never throws). */
export function parseAiNames(text: string): unknown[] {
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if (a < 0 || b <= a) return [];
  try {
    const obj = JSON.parse(text.slice(a, b + 1)) as { suggestions?: unknown };
    return Array.isArray(obj?.suggestions) ? obj.suggestions : [];
  } catch {
    return [];
  }
}

function norm(s: string): string {
  return s
    .normalize("NFC")
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Keeps only AI suggestions that are backed by the transcript: a real speaker, evidence that is a
 * literal quote from one line, and a name that appears inside that quote. Converts the 1-based
 * speaker numbers the model sees to 0-based.
 */
export function validateAiSuggestions(raw: unknown[], lines: NameLine[], named?: Record<string, string> | null): NameSuggestion[] {
  const present = new Set(lines.map((l) => l.s));
  const normLines = lines.map((l) => ({ n: norm(l.text), t: l.t, s: l.s }));
  const bestPerSpeaker = new Map<number, NameSuggestion>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (typeof r.speaker !== "number" || !Number.isInteger(r.speaker) || r.speaker < 1 || r.speaker > 50) continue;
    const speaker = r.speaker - 1;
    if (!present.has(speaker) || named?.[String(speaker)]?.trim()) continue;
    if (typeof r.name !== "string" || typeof r.evidence !== "string") continue;
    const name = r.name.trim().replace(/\s+/g, " ");
    if (!name || name.length > MAX_NAME || name.split(" ").length > 4) continue;
    if (/[\d@]|https?:|www\./i.test(name) || /speaker/i.test(name)) continue;
    const ev = norm(r.evidence);
    const nn = norm(name);
    if (!ev || !nn || !ev.includes(nn)) continue;
    const line = normLines.find((l) => l.n.includes(ev));
    if (!line) continue;
    const confidence: NameConfidence = r.confidence === "high" ? "high" : "medium";
    const sug: NameSuggestion = {
      speaker,
      name,
      confidence,
      source: "ai",
      evidence: r.evidence.trim().slice(0, 120),
      t: line.t,
    };
    const prev = bestPerSpeaker.get(speaker);
    if (!prev || (prev.confidence === "medium" && confidence === "high")) bestPerSpeaker.set(speaker, sug);
  }
  const seenNames = new Set<string>();
  return [...bestPerSpeaker.values()]
    .sort((a, b) => a.speaker - b.speaker)
    .filter((s) => {
      const k = key(s.name);
      if (seenNames.has(k)) return false;
      seenNames.add(k);
      return true;
    });
}

// ---------------------------------------------------------------- merging, keys

export function dismissKey(speaker: number, name: string): string {
  return `${speaker}|${key(name.trim())}`;
}

/** Cheap identity of a transcript, used to know when a cached AI result is stale. */
export function transcriptFingerprint(parts: TranscriptPart[]): string {
  const last = parts[parts.length - 1];
  return `${parts.length}:${new Set(parts.map((p) => p.speaker)).size}:${typeof last?.t === "number" ? Math.floor(last.t) : "-"}`;
}

/**
 * One chip per unnamed speaker. A device hit is a literal self-introduction, so it wins over a
 * different AI name; when both agree the chip is "high". Dismissed suggestions are hidden.
 */
export function mergeSuggestions(
  device: NameSuggestion[],
  ai: NameSuggestion[],
  opts: { names?: SpeakerNames; dismissed?: string[] } = {}
): NameSuggestion[] {
  const dismissed = new Set(opts.dismissed ?? []);
  const ok = (s: NameSuggestion) => !opts.names?.[String(s.speaker)]?.trim() && !dismissed.has(dismissKey(s.speaker, s.name));
  const d = new Map(device.filter(ok).map((s) => [s.speaker, s]));
  const a = new Map(ai.filter(ok).map((s) => [s.speaker, s]));
  const out: NameSuggestion[] = [];
  for (const speaker of new Set([...d.keys(), ...a.keys()])) {
    const ds = d.get(speaker);
    const as = a.get(speaker);
    if (ds && as && key(ds.name) === key(as.name)) out.push({ ...ds, confidence: "high" });
    else if (ds) out.push(ds);
    else if (as) out.push(as);
  }
  return out.sort((x, y) => x.speaker - y.speaker);
}
