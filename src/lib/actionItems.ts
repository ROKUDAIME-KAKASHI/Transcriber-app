import { z } from "zod";

/** Pure helpers for action-item extraction. No imports beyond zod, so node:test can load them. */

export const MAX_EXTRACTED_ITEMS = 50;
export const MAX_SAVE_ITEMS = 100;

/** Words per model call; same size as the minutes route's chunks. */
export const CHUNK_WORDS = 12_000;
/** Beyond this many chunks the rest of a very long meeting is left out (the caller is told). */
export const MAX_CHUNKS = 8;

export interface ExtractedItem {
  task: string;
  owner: string | null;
  deadlineText: string | null;
  sourceQuote: string;
  /** False when the quote could not be found in the transcript. */
  verified: boolean;
}

export interface SaveItem {
  task: string;
  owner: string | null;
  deadlineText: string | null;
  sourceQuote: string;
}

/**
 * The extraction rules and output shape. The combined minutes request (src/lib/combined.ts) embeds this text
 * word for word, so any change here changes both paths.
 */
export const ACTION_ITEMS_INSTRUCTIONS = `Extract action items from the meeting transcript below.

Rules:
- Include only explicit commitments or clearly assigned tasks.
- Do not turn suggestions or general discussion into tasks.
- Do not invent owners or deadlines.
- Use null when an owner or deadline is not specified.
- Preserve deadline wording exactly as spoken.
- Include an exact supporting quote from the transcript.
- Return only JSON in the following structure:

{
  "action_items": [
    {
      "task": "What needs to be done",
      "owner": null,
      "deadline_text": null,
      "source_quote": "Exact supporting text"
    }
  ]
}

If there are no explicit action items, return:
{"action_items": []}`;

const TEMPLATE = `${ACTION_ITEMS_INSTRUCTIONS}

Transcript:
{{transcript}}`;

export function buildActionItemsPrompt(transcript: string): string {
  // A function replacer, so "$&" and friends inside the transcript stay literal.
  return TEMPLATE.replace("{{transcript}}", () => transcript);
}

/** Split "Name: text" lines into chunks of about `maxWords` words. Reports whether lines were dropped. */
export function chunkLines(
  lines: string[],
  maxWords = CHUNK_WORDS,
  maxChunks = MAX_CHUNKS
): { chunks: string[]; truncated: boolean } {
  const chunks: string[] = [];
  let current: string[] = [];
  let words = 0;
  let truncated = false;
  for (const line of lines) {
    const n = line.split(/\s+/).filter(Boolean).length;
    if (words + n > maxWords && current.length) {
      chunks.push(current.join("\n"));
      current = [];
      words = 0;
    }
    if (chunks.length >= maxChunks) {
      truncated = true;
      current = [];
      break;
    }
    current.push(line);
    words += n;
  }
  if (current.length) chunks.push(current.join("\n"));
  return { chunks, truncated };
}

const RawItem = z.object({
  task: z.string(),
  owner: z.string().nullish(),
  deadline_text: z.string().nullish(),
  source_quote: z.string().nullish(),
});

function clean(v: string | null | undefined, max: number): string | null {
  const t = (v ?? "").replace(/\s+/g, " ").trim();
  if (!t || /^(null|none|n\/a|unassigned|not specified)$/i.test(t)) return null;
  return t.slice(0, max);
}

/** Pull the first JSON value out of model text, tolerating fences and prose around it. */
export function extractJson(text: string): unknown {
  const t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [t, fence?.[1]?.trim()].filter((c): c is string => !!c);
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) candidates.push(t.slice(start, end + 1));
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

/** Lenient validation of a list of raw items. Bad entries are skipped; the result is capped. */
export function validateActionItems(list: unknown[]): Omit<ExtractedItem, "verified">[] {
  const out: Omit<ExtractedItem, "verified">[] = [];
  for (const raw of list) {
    const r = RawItem.safeParse(raw);
    if (!r.success) continue;
    const task = clean(r.data.task, 300);
    if (!task) continue;
    out.push({
      task,
      owner: clean(r.data.owner, 100),
      deadlineText: clean(r.data.deadline_text, 100),
      sourceQuote: clean(r.data.source_quote, 1000) ?? "",
    });
    if (out.length >= MAX_EXTRACTED_ITEMS) break;
  }
  return out;
}

/** Lenient parse + validation. Bad entries are skipped; returns [] for anything unusable. */
export function parseActionItems(text: string): Omit<ExtractedItem, "verified">[] {
  const json = extractJson(text);
  const list = Array.isArray(json)
    ? json
    : json && typeof json === "object" && Array.isArray((json as { action_items?: unknown }).action_items)
      ? (json as { action_items: unknown[] }).action_items
      : [];
  return validateActionItems(list);
}

export function normalizeForMatch(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** True when the quote appears in the transcript, ignoring case and whitespace differences. */
export function quoteInTranscript(quote: string, transcript: string): boolean {
  const q = normalizeForMatch(quote);
  if (!q) return false;
  return normalizeForMatch(transcript).includes(q);
}

export function verifyItems(items: Omit<ExtractedItem, "verified">[], transcript: string): ExtractedItem[] {
  const hay = normalizeForMatch(transcript);
  return items.map((i) => {
    const q = normalizeForMatch(i.sourceQuote);
    return { ...i, verified: q.length > 0 && hay.includes(q) };
  });
}

/** Merge items from several chunks, dropping repeats of the same task, capped at the maximum. */
export function mergeItems(lists: ExtractedItem[][]): ExtractedItem[] {
  const seen = new Set<string>();
  const out: ExtractedItem[] = [];
  for (const i of lists.flat()) {
    const key = normalizeForMatch(i.task);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(i);
    if (out.length >= MAX_EXTRACTED_ITEMS) break;
  }
  return out;
}

const optText = (max: number) =>
  z
    .string()
    .max(max)
    .nullable()
    .transform((v) => {
      const t = v?.trim();
      return t ? t : null;
    });

export const SaveBody = z.object({
  items: z
    .array(
      z.object({
        task: z.string().trim().min(1).max(300),
        owner: optText(100),
        /** The People entry picked as owner (ignored when the tracker upgrades are off or the person is unknown). */
        ownerStakeholderId: z.string().trim().min(1).max(64).nullish(),
        deadlineText: optText(100),
        sourceQuote: z.string().max(1000),
      })
    )
    .min(1)
    .max(MAX_SAVE_ITEMS),
});

/** The extract route accepts phrases up to this long. */
export const MAX_PHRASE_CHARS = 5000;

/** Split any phrase longer than the limit at word boundaries, so the fallback transcript is never rejected as too long. */
export function splitLongPhrases<T extends { text: string }>(parts: readonly T[], max = MAX_PHRASE_CHARS): T[] {
  const out: T[] = [];
  for (const p of parts) {
    if (p.text.length <= max) {
      out.push(p);
      continue;
    }
    let rest = p.text;
    while (rest.length > max) {
      let cut = rest.lastIndexOf(" ", max);
      if (cut < max / 2) cut = max;
      out.push({ ...p, text: rest.slice(0, cut).trimEnd() });
      rest = rest.slice(cut).trimStart();
    }
    if (rest) out.push({ ...p, text: rest });
  }
  return out;
}
