"use client";

import { useEffect, useState } from "react";
import { MAX_FREEBUSY_EMAILS, SUGGEST_DAYS, findCommonSlots, type CommonSlot, type Interval, type PersonAvailability, type WorkingHours } from "./calendar";
import type { AvailabilityRange } from "./scheduling";

/** Result of a calendar fetch: ok, "unavailable" (switched off, not migrated, offline or any failure) or a message. */
export type CalResult<T> = { ok: true; data: T } | { ok: false; unavailable: boolean; error: string };

async function getJson<T>(url: string): Promise<CalResult<T>> {
  try {
    const r = await fetch(url, { cache: "no-store" });
    if (r.ok) return { ok: true, data: (await r.json()) as T };
    const j = (await r.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, unavailable: r.status === 503, error: j?.error ?? "Couldn't load the calendar. Try again." };
  } catch {
    return { ok: false, unavailable: false, error: "Couldn't reach the server. Check the connection and try again." };
  }
}

export interface MineResponse {
  timeZone: string | null;
  workingHours: AvailabilityRange[];
  busy: { start: string; end: string; title: string; kind: "booking" | "plan" }[];
}

export function fetchMine(fromMs: number, toMs: number, excludePlanId?: string): Promise<CalResult<MineResponse>> {
  const q = new URLSearchParams({ from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString() });
  if (excludePlanId) q.set("exclude", excludePlanId);
  return getJson<MineResponse>(`/api/calendar/mine?${q}`);
}

export type FreeBusyEntry =
  | { status: "unknown" }
  | { status: "shared"; busy: { start: string; end: string }[]; workingHours: { timeZone: string; ranges: AvailabilityRange[] } | null };

export async function fetchFreeBusy(emails: string[], fromMs: number, toMs: number): Promise<CalResult<Record<string, FreeBusyEntry>>> {
  const out: Record<string, FreeBusyEntry> = {};
  for (let i = 0; i < emails.length; i += MAX_FREEBUSY_EMAILS) {
    const q = new URLSearchParams({
      emails: emails.slice(i, i + MAX_FREEBUSY_EMAILS).join(","),
      from: new Date(fromMs).toISOString(),
      to: new Date(toMs).toISOString(),
    });
    const r = await getJson<{ people: Record<string, FreeBusyEntry> }>(`/api/freebusy?${q}`);
    if (!r.ok) return r;
    Object.assign(out, r.data.people);
  }
  return { ok: true, data: out };
}

export interface Suggestions {
  slots: CommonSlot[];
  /** Attendee names whose availability couldn't be read (no email, no account, or not shared). */
  unknownNames: string[];
}

/**
 * Up to six times in the next two weeks when you and every attendee with shared availability are free.
 * Attendees without an address, an account or sharing turned on are listed as "unknown", never guessed.
 */
export async function suggestTimes(opts: {
  attendees: { name: string; email: string }[];
  durationMin: number;
  excludePlanId?: string;
  fallbackTz: string;
  displayTz: string;
}): Promise<CalResult<Suggestions>> {
  const from = Date.now();
  const to = from + SUGGEST_DAYS * 86_400_000;
  const mine = await fetchMine(from, to, opts.excludePlanId);
  if (!mine.ok) return mine;
  const emails = [...new Set(opts.attendees.map((a) => a.email.trim().toLowerCase()).filter(Boolean))];
  const fb = emails.length ? await fetchFreeBusy(emails, from, to) : ({ ok: true, data: {} } as CalResult<Record<string, FreeBusyEntry>>);
  const shared = fb.ok ? fb.data : {};

  const myHours: WorkingHours = { timeZone: mine.data.timeZone ?? opts.fallbackTz, ranges: mine.data.workingHours };
  const toIv = (b: { start: string; end: string }): Interval => ({ start: new Date(b.start).getTime(), end: new Date(b.end).getTime() });
  const people: PersonAvailability[] = [{ key: "me", busy: mine.data.busy.map(toIv), working: myHours }];
  const unknownNames: string[] = [];
  const done = new Set<string>();
  for (const a of opts.attendees) {
    const email = a.email.trim().toLowerCase();
    const entry = email ? shared[email] : undefined;
    if (!entry || entry.status !== "shared") {
      unknownNames.push(a.name);
      continue;
    }
    if (done.has(email)) continue;
    done.add(email);
    people.push({ key: email, busy: entry.busy.map(toIv), working: entry.workingHours });
  }
  const slots = findCommonSlots({
    people,
    fallbackWorking: myHours,
    durationMin: opts.durationMin,
    fromMs: from + 15 * 60_000,
    toMs: to,
    displayTz: opts.displayTz,
  });
  return { ok: true, data: { slots, unknownNames } };
}

export interface PlanCalendarInfo {
  icsSequence: number;
  invited: Record<string, string>;
  emailConfigured: boolean;
}

export function fetchPlanCalendar(planId: string): Promise<CalResult<PlanCalendarInfo>> {
  return getJson<PlanCalendarInfo>(`/api/plans/${encodeURIComponent(planId)}/calendar`);
}

/* ---------- Is the calendar feature usable right now? ---------- */

let probe: { at: number; ready: boolean; pending: Promise<boolean> | null } = { at: 0, ready: false, pending: null };
const PROBE_TTL_MS = 60_000;

/** One cheap request: true when the switch is on and 6_calendar is applied. Cached for a minute. */
export function probeCalendar(): Promise<boolean> {
  if (probe.pending) return probe.pending;
  if (Date.now() - probe.at < PROBE_TTL_MS) return Promise.resolve(probe.ready);
  const pending = fetch("/api/calendar/prefs", { cache: "no-store" })
    .then((r) => r.ok)
    .catch(() => false)
    .then((ready) => {
      probe = { at: Date.now(), ready, pending: null };
      return ready;
    });
  probe = { ...probe, pending };
  return pending;
}

/** False while loading, offline, switched off or not yet migrated: the calendar UI stays hidden. */
export function useCalendarReady(enabled: boolean): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!enabled) {
      setReady(false);
      return;
    }
    let cancelled = false;
    void probeCalendar().then((r) => {
      if (!cancelled) setReady(r);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return enabled && ready;
}
