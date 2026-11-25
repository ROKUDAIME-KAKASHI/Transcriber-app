"use client";

import { getLocalDb } from "./local/db";
import { getFlagNow } from "./flagsClient";

/**
 * Recording from a plan. Record opens with /?plan=<id>&title=<title>: the plan id is kept here (like the
 * title prefill) until a meeting really starts, then linked to that meeting. The link is saved on the
 * device first (kv `planLink:<meetingId>`) and sent whenever the server can be reached, so recording works
 * offline and a failed link never blocks or breaks a recording.
 */
const KEY = "transcriber.planPrefill";
const PREFIX = "planLink:";
const ID_RE = /^[A-Za-z0-9_-]{8,40}$/;
const MAX_TRIES = 30;

let memory: string | null = null;

export function cleanPlanId(raw: string | null | undefined): string | null {
  const t = (raw ?? "").trim();
  return ID_RE.test(t) ? t : null;
}

export function setPlanPrefill(raw: string | null | undefined): void {
  memory = cleanPlanId(raw);
  try {
    if (memory) sessionStorage.setItem(KEY, memory);
    else sessionStorage.removeItem(KEY);
  } catch {
    /* storage blocked: the in-memory copy still works */
  }
}

export function peekPlanPrefill(): string | null {
  if (memory) return memory;
  try {
    return cleanPlanId(sessionStorage.getItem(KEY));
  } catch {
    return null;
  }
}

interface Pending {
  planId: string;
  tries: number;
}

/** "done": linked (or a permanent answer, so stop). "retry": try again later (offline, signed out, server busy). */
async function send(planId: string, meetingId: string): Promise<"done" | "retry"> {
  try {
    const r = await fetch(`/api/plans/${encodeURIComponent(planId)}/link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meetingId }),
    });
    if (r.ok) return "done";
    // 400/404/409: the plan is gone, already used, or not this user's. Retrying can't help.
    if (r.status === 400 || r.status === 404 || r.status === 409) return "done";
    return "retry";
  } catch {
    return "retry";
  }
}

async function settle(userId: string | null, meetingId: string, p: Pending): Promise<void> {
  const result = await send(p.planId, meetingId);
  if (!userId) return;
  try {
    const kv = getLocalDb(userId).kv;
    if (result === "done" || p.tries + 1 >= MAX_TRIES) await kv.delete(PREFIX + meetingId);
    else await kv.put({ key: PREFIX + meetingId, value: { planId: p.planId, tries: p.tries + 1 } satisfies Pending });
  } catch {
    /* device storage unavailable: nothing to update */
  }
}

/** Call once a meeting has really started. Takes the plan prefill (if any) and links it to `meetingId`. */
export function linkStartedMeeting(userId: string | null, meetingId: string | null | undefined): void {
  const planId = peekPlanPrefill();
  if (!planId) return;
  setPlanPrefill(null);
  if (!meetingId || !getFlagNow("plannedMeetings")) return;
  void (async () => {
    const p: Pending = { planId, tries: 0 };
    if (userId) {
      try {
        await getLocalDb(userId).kv.put({ key: PREFIX + meetingId, value: p });
      } catch {
        /* still try once below */
      }
    }
    await settle(userId, meetingId, p);
  })();
}

let flushing = false;

/** Sends links that were saved while offline or signed out. Safe to call often. */
export async function flushPlanLinks(userId: string): Promise<void> {
  if (flushing || typeof navigator !== "undefined" && navigator.onLine === false) return;
  flushing = true;
  try {
    const rows = await getLocalDb(userId).kv.where("key").startsWith(PREFIX).toArray();
    for (const row of rows) {
      const v = row.value as Partial<Pending> | null;
      const meetingId = row.key.slice(PREFIX.length);
      if (!v?.planId || !cleanPlanId(v.planId) || !meetingId) {
        await getLocalDb(userId).kv.delete(row.key);
        continue;
      }
      await settle(userId, meetingId, { planId: v.planId, tries: typeof v.tries === "number" ? v.tries : 0 });
    }
  } catch {
    /* device storage unavailable */
  } finally {
    flushing = false;
  }
}
