"use client";

import { useSyncExternalStore } from "react";
import type { ExtractedItem } from "./actionItems.ts";
import type { MeetingSummary } from "./combined.ts";
import { addSample, claim, enqueue, estimateSeconds, parseSamples, queuedIds, settle, type KV } from "./autoMinutesCore.ts";
import { writeExtras } from "./meetingExtras";
import { flush } from "@/lib/local/sync";
import { setServerDocument } from "@/lib/local/repo";

/**
 * Client side of "write the minutes for me": one request for minutes + summary + action items, with the
 * existing separate calls as the fallback, plus the auto-run after Stop (queued, once per meeting).
 */

export interface GenOutcome {
  document: string;
  template: string;
  summary: MeetingSummary | null;
  items: ExtractedItem[] | null;
  /** The server already had minutes for this meeting and returned them unchanged. */
  alreadyDone: boolean;
}

export class GenError extends Error {
  /** True when the request never got an answer (offline, screen locked): the server may still have finished. */
  network: boolean;
  status: number | undefined;
  constructor(message: string, opts: { network?: boolean; status?: number } = {}) {
    super(message);
    this.network = !!opts.network;
    this.status = opts.status;
  }
}

async function readJson<T>(res: Response): Promise<T | null> {
  return (await res.json().catch(() => null)) as T | null;
}

async function post(url: string, body: unknown): Promise<Response> {
  try {
    return await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new GenError("Couldn't reach the server.", { network: true });
  }
}

/** Existing action-item extractor. Failure is not fatal for the minutes: the user can run it from the tab. */
async function extractSeparately(meetingId: string): Promise<ExtractedItem[] | null> {
  try {
    const res = await post(`/api/meetings/${meetingId}/action-items/extract`, {});
    if (!res.ok) return null;
    const data = await readJson<{ items?: ExtractedItem[] }>(res);
    return Array.isArray(data?.items) ? data.items : null;
  } catch {
    return null;
  }
}

/** Existing minutes route (also handles very long meetings in chunks). */
async function processSeparately(meetingId: string, template: string, model: string): Promise<{ document: string; template: string }> {
  const res = await post(`/api/meetings/${meetingId}/process`, { template, model });
  const data = await readJson<{ document?: string; template?: string; error?: string }>(res);
  if (res.ok && data?.document) return { document: data.document, template: data.template ?? template };
  if (!data) throw new GenError("The server sent an unreadable reply.", { network: true, status: res.status });
  throw new GenError(
    data.error ||
      (res.status === 504 || res.status === 502
        ? "The AI took too long or the server is busy. Try again, or pick GLM Flash."
        : "Processing failed. Please try again."),
    { status: res.status }
  );
}

/**
 * Minutes, summary and action items in one go. With `combined` off this is just the old minutes call.
 * Falls back to the separate calls whenever the combined reply cannot be used.
 */
export async function generateAll(
  meetingId: string,
  opts: { template: string; model: string; force: boolean; combined: boolean }
): Promise<GenOutcome> {
  if (opts.combined) {
    const res = await post(`/api/meetings/${meetingId}/generate`, { template: opts.template, model: opts.model, force: opts.force });
    const data = await readJson<{
      document?: string;
      template?: string;
      summary?: MeetingSummary | null;
      items?: ExtractedItem[] | null;
      alreadyDone?: boolean;
      fallback?: boolean;
      error?: string;
    }>(res);
    if (res.ok && data?.document && !data.fallback) {
      const alreadyDone = !!data.alreadyDone;
      let items = alreadyDone ? null : (data.items ?? null);
      if (!alreadyDone && items === null) items = await extractSeparately(meetingId);
      return { document: data.document, template: data.template ?? opts.template, summary: data.summary ?? null, items, alreadyDone };
    }
    // 404 = the switch is off on the server; any `fallback` = the reply could not be used or the meeting is very long.
    const useFallback = !!data?.fallback || res.status === 404;
    if (!useFallback) {
      if (!data) throw new GenError("The server sent an unreadable reply.", { network: true, status: res.status });
      throw new GenError(data.error || "Processing failed. Please try again.", { status: res.status });
    }
  }
  const doc = await processSeparately(meetingId, opts.template, opts.model);
  return { ...doc, summary: null, items: await extractSeparately(meetingId), alreadyDone: false };
}

/** Summary only (the combined reply had none, or the minutes came from the fallback). */
export async function generateSummaryOnly(meetingId: string, model: string): Promise<MeetingSummary> {
  const res = await post(`/api/meetings/${meetingId}/generate`, { model, only: "summary" });
  const data = await readJson<{ summary?: MeetingSummary; error?: string }>(res);
  if (res.ok && data?.summary) return data.summary;
  throw new GenError(data?.error || "Couldn't write the summary. Try again.", { status: res.status });
}

/* ---------- timing history (this device) ---------- */

const SAMPLES_KEY = "minutely.genTimes";

export function etaFor(words: number): number {
  try {
    return estimateSeconds(words, parseSamples(localStorage.getItem(SAMPLES_KEY)));
  } catch {
    return estimateSeconds(words, []);
  }
}

export function recordTiming(words: number, secs: number): void {
  try {
    localStorage.setItem(SAMPLES_KEY, JSON.stringify(addSample(parseSamples(localStorage.getItem(SAMPLES_KEY)), { words, secs })));
  } catch {
    /* ignore */
  }
}

/* ---------- job state (in memory) ---------- */

export type JobPhase = "waiting" | "uploading" | "writing" | "done" | "error";
export interface Job {
  phase: JobPhase;
  /** Estimated seconds for the writing step. */
  etaSec: number;
  /** When the writing step began (epoch ms). */
  startedAt: number;
  error: string | null;
  document: string | null;
  template: string | null;
}

const jobs = new Map<string, Job>();
const listeners = new Set<() => void>();

function setJob(id: string, job: Job | null) {
  if (job) jobs.set(id, job);
  else jobs.delete(id);
  listeners.forEach((l) => l());
}

export function getJob(id: string): Job | null {
  return jobs.get(id) ?? null;
}

export function useJob(id: string): Job | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => jobs.get(id) ?? null,
    () => null
  );
}

/* ---------- auto run after Stop ---------- */

const BOOK_KEY = "minutely.autoMinutes.v1";
const book: KV = {
  get: () => {
    try {
      return localStorage.getItem(BOOK_KEY);
    } catch {
      return null;
    }
  },
  set: (v) => {
    localStorage.setItem(BOOK_KEY, v);
  },
};

/** Called when a recording has stopped and been saved. Returns false for a meeting already queued or done, or too short. */
export function enqueueAuto(meetingId: string, words: number): boolean {
  const ok = enqueue(book, meetingId, words, Date.now());
  if (ok) {
    setJob(meetingId, { phase: "waiting", etaSec: etaFor(words), startedAt: 0, error: null, document: null, template: null });
    window.dispatchEvent(new Event("minutely:autominutes"));
  }
  return ok;
}

export function pendingAutoIds(): string[] {
  return queuedIds(book, Date.now());
}

const token = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

/** Run one queued meeting. Safe to call from several places: only the caller that wins the claim does the work. */
export async function runAuto(userId: string, meetingId: string): Promise<void> {
  const tok = token();
  if (!claim(book, meetingId, Date.now(), tok)) return;
  const words = (() => {
    try {
      const e = JSON.parse(localStorage.getItem(BOOK_KEY) ?? "{}")[meetingId];
      return typeof e?.words === "number" ? e.words : 0;
    } catch {
      return 0;
    }
  })();
  const etaSec = etaFor(words);
  setJob(meetingId, { phase: "uploading", etaSec, startedAt: 0, error: null, document: null, template: null });

  // The server writes from its own copy, so the whole transcript has to be there first.
  const r = await flush(meetingId, { timeoutMs: 20_000 });
  if (r !== "synced") {
    settle(book, meetingId, "queued", Date.now());
    setJob(meetingId, { phase: "waiting", etaSec, startedAt: 0, error: null, document: null, template: null });
    return;
  }

  const startedAt = Date.now();
  setJob(meetingId, { phase: "writing", etaSec, startedAt, error: null, document: null, template: null });
  try {
    const out = await generateAll(meetingId, { template: "MOM", model: "glm", force: false, combined: true });
    await applyOutcome(userId, meetingId, out);
    if (!out.alreadyDone) recordTiming(words, (Date.now() - startedAt) / 1000);
    settle(book, meetingId, "done", Date.now());
    setJob(meetingId, { phase: "done", etaSec, startedAt, error: null, document: out.document, template: out.template });
  } catch (e) {
    const err = e instanceof GenError ? e : new GenError("Couldn't write the minutes.");
    if (err.network && typeof navigator !== "undefined" && navigator.onLine === false) {
      // Lost the connection mid-way: try again when it is back.
      settle(book, meetingId, "queued", Date.now());
      setJob(meetingId, { phase: "waiting", etaSec, startedAt: 0, error: null, document: null, template: null });
      return;
    }
    settle(book, meetingId, "failed", Date.now());
    setJob(meetingId, { phase: "error", etaSec, startedAt, error: err.message, document: null, template: null });
  }
}

/** Save what a run produced on this device: the document in the local copy, summary and items beside it. */
export async function applyOutcome(userId: string | null, meetingId: string, out: GenOutcome): Promise<void> {
  if (userId) await setServerDocument(userId, meetingId, out.document, out.template);
  if (out.alreadyDone) return;
  writeExtras(meetingId, { summary: out.summary, ...(out.items !== null ? { items: out.items } : {}) });
}

/** "Try again" after a failed automatic run: runs now, outside the once-only book (the user asked for it). */
export async function retryNow(userId: string, meetingId: string, words: number): Promise<void> {
  const etaSec = etaFor(words);
  const startedAt = Date.now();
  setJob(meetingId, { phase: "writing", etaSec, startedAt, error: null, document: null, template: null });
  try {
    const r = await flush(meetingId, { timeoutMs: 20_000 });
    if (r !== "synced") throw new GenError("Waiting to upload the transcript. Connect to the internet and try again.");
    const out = await generateAll(meetingId, { template: "MOM", model: "glm", force: false, combined: true });
    await applyOutcome(userId, meetingId, out);
    if (!out.alreadyDone) recordTiming(words, (Date.now() - startedAt) / 1000);
    settle(book, meetingId, "done", Date.now());
    setJob(meetingId, { phase: "done", etaSec, startedAt, error: null, document: out.document, template: out.template });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Couldn't write the minutes.";
    setJob(meetingId, { phase: "error", etaSec, startedAt, error: msg, document: null, template: null });
  }
}
