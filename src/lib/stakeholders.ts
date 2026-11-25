import { z } from "zod";
import { normalizeTaskText, similarity } from "./dedupe.ts";

/** Pure helpers for the People directory. Only zod and dedupe are imported, so node:test can load this file. */

export const NAME_DUP = 0.85;
export const MAX_IMPORT = 200;

const text = (max: number) =>
  z
    .string()
    .max(max)
    .transform((s) => s.trim())
    .transform((s) => (s === "" ? null : s))
    .nullish();

const email = z
  .string()
  .max(200)
  .transform((s) => s.trim().toLowerCase())
  .refine((s) => s === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s), "Enter a valid email")
  .transform((s) => (s === "" ? null : s))
  .nullish();

const name = z
  .string()
  .max(100)
  .transform((s) => s.trim())
  .refine((s) => s.length > 0, "Name is required");

const fields = {
  designation: text(100),
  organisation: text(100),
  area: text(100),
  email,
  phone: text(40),
  notes: text(2000),
};

export const CreateBody = z.object({ name, ...fields });
export const PatchBody = z
  .object({ name: name.optional(), ...fields })
  .refine((b) => Object.keys(b).length > 0, "Nothing to update");
export const ImportBody = z.object({
  people: z
    .array(z.object({ name, designation: fields.designation, area: fields.area, organisation: fields.organisation, email }))
    .min(1)
    .max(MAX_IMPORT),
});

export interface PersonLite {
  id: string;
  name: string;
  email?: string | null;
}

export function normEmail(e: string | null | undefined): string {
  return (e ?? "").trim().toLowerCase();
}

export type DupReason = "email" | "name";

/** The first existing person that has the same email (case-insensitive) or a name at least 0.85 similar. Email wins. */
export function findPossibleDuplicate(
  candidate: { name: string; email?: string | null },
  existing: readonly PersonLite[],
  ignoreId?: string
): { person: PersonLite; reason: DupReason } | null {
  const e = normEmail(candidate.email);
  const pool = existing.filter((p) => p.id !== ignoreId);
  if (e) {
    const hit = pool.find((p) => normEmail(p.email) === e);
    if (hit) return { person: hit, reason: "email" };
  }
  if (!normalizeTaskText(candidate.name)) return null;
  let best: PersonLite | null = null;
  let bestScore = 0;
  for (const p of pool) {
    const s = similarity(candidate.name, p.name);
    if (s >= NAME_DUP && s > bestScore) {
      best = p;
      bestScore = s;
    }
  }
  return best ? { person: best, reason: "name" } : null;
}

export interface Person {
  id: string;
  name: string;
  designation: string | null;
  organisation: string | null;
  area: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
}

/** Case-insensitive match over name, email, designation, organisation and area. Empty query keeps everyone. */
export function matchesQuery(p: Pick<Person, "name" | "email" | "designation" | "organisation" | "area">, q: string): boolean {
  const n = q.trim().toLowerCase();
  if (!n) return true;
  return [p.name, p.email, p.designation, p.organisation, p.area].some((v) => (v ?? "").toLowerCase().includes(n));
}

export function sortPeople<T extends { name: string }>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

/** First letter of the name, uppercased; anything that isn't a letter goes under "#". */
export function groupLetter(n: string): string {
  const c = (n.trim().normalize("NFKD").replace(/\p{M}/gu, "")[0] ?? "").toUpperCase();
  return /\p{L}/u.test(c) ? c : "#";
}

export function groupAlphabetically<T extends { name: string }>(list: readonly T[]): { letter: string; people: T[] }[] {
  const out: { letter: string; people: T[] }[] = [];
  for (const p of sortPeople(list)) {
    const l = groupLetter(p.name);
    const last = out[out.length - 1];
    if (last && last.letter === l) last.people.push(p);
    else out.push({ letter: l, people: [p] });
  }
  // "#" last
  const hash = out.findIndex((g) => g.letter === "#");
  if (hash >= 0 && hash !== out.length - 1) out.push(out.splice(hash, 1)[0]);
  return out;
}

export interface Suggestion {
  name: string;
  email: string | null;
  source: "task owner" | "speaker" | "booking";
}

/**
 * People mentioned in meetings, tasks and bookings who aren't in the directory yet.
 * Deduped within the list (by email, then by name); anything already in the directory
 * (same email, or the same name after normalising) is dropped. Booking guests come first because they carry an email.
 */
export function buildSuggestions(
  existing: readonly PersonLite[],
  sources: { owners?: readonly string[]; speakers?: readonly string[]; bookings?: readonly { name: string; email: string }[] },
  limit = 12
): Suggestion[] {
  const haveEmail = new Set(existing.map((p) => normEmail(p.email)).filter(Boolean));
  const haveName = new Set(existing.map((p) => normalizeTaskText(p.name)).filter(Boolean));
  const out: Suggestion[] = [];
  const add = (rawName: string, rawEmail: string | null, source: Suggestion["source"]) => {
    const nm = rawName.trim().replace(/\s+/g, " ");
    const em = normEmail(rawEmail) || null;
    const key = normalizeTaskText(nm);
    if (!key || nm.length > 100) return;
    if (/^speaker \d+$/i.test(nm)) return;
    if (em && haveEmail.has(em)) return;
    if (haveName.has(key)) return;
    if (em) haveEmail.add(em);
    haveName.add(key);
    out.push({ name: nm, email: em, source });
  };
  for (const b of sources.bookings ?? []) add(b.name, b.email, "booking");
  for (const n of sources.speakers ?? []) add(n, null, "speaker");
  for (const n of sources.owners ?? []) add(n, null, "task owner");
  return out.slice(0, limit);
}

/** Picker options: directory people matching the text, name-prefix matches first. */
export function pickerOptions<T extends Person>(people: readonly T[], q: string, limit = 8): T[] {
  const n = q.trim().toLowerCase();
  const hits = people.filter((p) => matchesQuery(p, q));
  const rank = (p: T) => (!n ? 0 : p.name.toLowerCase().startsWith(n) ? 0 : p.name.toLowerCase().includes(n) ? 1 : 2);
  return sortPeople(hits)
    .map((p, i) => ({ p, i, r: rank(p) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.p);
}

/** True when the typed text isn't already an exact (normalised) directory name: show "Add 'X' as new person". */
export function canAddNew(q: string, people: readonly { name: string }[]): boolean {
  const k = normalizeTaskText(q);
  return !!k && q.trim().length <= 100 && !people.some((p) => normalizeTaskText(p.name) === k);
}

export function personLine(p: Pick<Person, "designation" | "organisation">): string {
  return [p.designation, p.organisation].filter(Boolean).join(" · ");
}
