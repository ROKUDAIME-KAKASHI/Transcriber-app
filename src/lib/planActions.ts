"use client";

import { DocumentExport, hasPlugin, isNative } from "./native";
import { copyText, shareOrSave } from "./export/deliver";
import { isHttpUrl } from "./planning";
import type { DeliverResult } from "./export/types";

/** Opens a call link outside Minutely: the system browser in the app, a new tab on the web. http(s) only. */
export async function openCallLink(url: string): Promise<"opened" | "copied" | "invalid"> {
  if (!isHttpUrl(url)) return "invalid";
  if (isNative() && hasPlugin("DocumentExport")) {
    try {
      await DocumentExport.openExternal({ url });
      return "opened";
    } catch {
      /* an older app without openExternal: fall through */
    }
  }
  if (!isNative()) {
    const w = window.open(url, "_blank", "noopener,noreferrer");
    if (w) return "opened";
  }
  try {
    await copyText(url);
    return "copied";
  } catch {
    return "invalid";
  }
}

/** Fetches the plan's .ics and hands it to the share sheet (app) or a download (web). */
export async function deliverPlanIcs(planId: string, title: string): Promise<DeliverResult> {
  const r = await fetch(`/api/plans/${encodeURIComponent(planId)}/ics`, { cache: "no-store" });
  if (!r.ok) throw new Error(String(r.status));
  const text = await r.text();
  const blob = new Blob([text], { type: "text/calendar" });
  return shareOrSave({ kind: "txt", name: "meeting.ics", mime: "text/calendar", blob, text }, title);
}
