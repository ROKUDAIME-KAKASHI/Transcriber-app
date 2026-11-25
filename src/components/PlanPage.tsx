"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, CalendarPlus, ChevronLeft, CloudOff, Mail, Mic, Phone, Repeat, Settings2, Share2, X } from "lucide-react";
import { Badge, Button, FieldLabel, Notice, Panel, PanelHeader, cx, inputCls, selectCls } from "./ui";
import { PersonPicker } from "./PersonPicker";
import { PreworkSection } from "./PreworkSection";
import { FindATime } from "./FindATime";
import { SeriesSettingsSheet } from "./SeriesSettingsSheet";
import { SeriesProgressCard } from "./SeriesProgressCard";
import { useToast } from "./Toast";
import { useConnectivity } from "@/lib/connectivity";
import { useFlag } from "@/lib/flagsClient";
import { fetchMine, fetchPlanCalendar, useCalendarReady, type PlanCalendarInfo } from "@/lib/calendarClient";
import { conflictMessage, conflictsWith, inviteLabel, type BusyBlock } from "@/lib/calendar";
import { shareText } from "@/lib/export/deliver";
import { usePeople } from "@/lib/stakeholdersClient";
import { navBack } from "@/lib/navStack";
import { deliverPlanIcs, openCallLink } from "@/lib/planActions";
import {
  CADENCES, CADENCE_LABEL, PLAN_DURATIONS, blankForm, formFromPlan, formStart, inviteText, payloadFromForm, recordHref,
  type AttendeeForm, type Cadence, type PlanDTO, type PlanForm, type SeriesDTO,
} from "@/lib/planning";

const NEW_SERIES = "__new";

const chipCls = (on: boolean) =>
  cx(
    "inline-flex min-h-12 min-w-12 items-center justify-center rounded-chip border px-3 text-ui font-semibold transition-colors lg:min-h-10",
    on ? "border-accent bg-accent text-accent-foreground" : "border-border/70 bg-card hover:bg-muted"
  );

function timeZones(current: string): string[] {
  let list: string[] = [];
  try {
    list = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  } catch {
    list = [];
  }
  if (!list.includes("UTC")) list = ["UTC", ...list];
  return list.includes(current) ? list : [current, ...list];
}

async function errorOf(r: Response, fallback: string): Promise<string> {
  const j = (await r.json().catch(() => null)) as { error?: string } | null;
  return j?.error ?? fallback;
}

function Field({ id, label, children, hint }: { id: string; label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {children}
      {hint && <p className="mt-1 text-meta text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function PlanPage() {
  const router = useRouter();
  const search = useSearchParams();
  const toast = useToast();
  const offline = useConnectivity() === "offline";
  const { people } = usePeople();

  const id = search.get("id");
  const seriesParam = search.get("seriesId");

  const browserTz = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      return "UTC";
    }
  }, []);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlanDTO | null>(null);
  const [form, setForm] = useState<PlanForm | null>(null);
  const [series, setSeries] = useState<SeriesDTO[]>([]);
  const [newSeriesCadence, setNewSeriesCadence] = useState<Cadence>("WEEKLY");
  const [newSeriesTitle, setNewSeriesTitle] = useState("");
  const [editingTz, setEditingTz] = useState(false);
  const [attName, setAttName] = useState("");
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const calOn = useFlag("calendar");
  const calReady = useCalendarReady(calOn && !offline);
  const [calInfo, setCalInfo] = useState<PlanCalendarInfo | null>(null);
  const [conflicts, setConflicts] = useState<BusyBlock[]>([]);
  const [seriesSheet, setSeriesSheet] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const sr = await fetch("/api/series", { cache: "no-store" }).catch(() => null);
      const sj = sr?.ok ? ((await sr.json().catch(() => null)) as { series?: SeriesDTO[] } | null) : null;
      const list = sj?.series ?? [];
      setSeries(list);
      if (id) {
        const r = await fetch(`/api/plans/${encodeURIComponent(id)}`, { cache: "no-store" });
        if (!r.ok) {
          setLoadError(r.status === 404 ? "This planned meeting no longer exists." : await errorOf(r, "Couldn't load this meeting. Try again."));
          return;
        }
        const p = ((await r.json()) as { plan: PlanDTO }).plan;
        setPlan(p);
        setForm(formFromPlan(p));
      } else {
        const s = seriesParam ? list.find((x) => x.id === seriesParam) : undefined;
        setPlan(null);
        setForm(
          blankForm(new Date(), browserTz, s ? {
            title: s.title, durationMin: s.defaultDurationMin, venue: s.defaultVenue ?? "", callUrl: s.defaultCallUrl ?? "", seriesId: s.id,
          } : undefined)
        );
      }
    } catch {
      setLoadError("Couldn't reach the server. Check the connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [id, seriesParam, browserTz]);

  useEffect(() => {
    void load();
  }, [load]);

  const planId = plan?.id;
  const planStatus = plan?.status;
  const reloadCal = useCallback(async () => {
    if (!planId) return;
    const r = await fetchPlanCalendar(planId);
    setCalInfo(r.ok ? r.data : null);
  }, [planId]);

  // Who was emailed, and whether the server can email at all. Hidden until the calendar feature is usable.
  useEffect(() => {
    if (!calReady || !planId) {
      setCalInfo(null);
      return;
    }
    void reloadCal();
  }, [calReady, planId, reloadCal]);

  // Non-blocking heads-up when the chosen time overlaps something already in your calendar.
  const fDate = form?.date;
  const fTime = form?.time;
  const fTz = form?.timeZone;
  const fDur = form?.durationMin;
  useEffect(() => {
    const start = formStart({ date: fDate ?? "", time: fTime ?? "", timeZone: fTz ?? "UTC" });
    if (!calReady || !start.ok || !fDur || (planStatus && planStatus !== "PLANNED")) {
      setConflicts([]);
      return;
    }
    const startMs = new Date(start.startAt).getTime();
    const endMs = startMs + fDur * 60_000;
    let cancelled = false;
    const t = setTimeout(async () => {
      const r = await fetchMine(startMs - 12 * 3_600_000, endMs + 12 * 3_600_000, planId);
      if (cancelled) return;
      setConflicts(
        r.ok ? conflictsWith(r.data.busy.map((b) => ({ startMs: new Date(b.start).getTime(), endMs: new Date(b.end).getTime(), title: b.title })), startMs, endMs) : []
      );
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [calReady, fDate, fTime, fTz, fDur, planId, planStatus]);

  const set = <K extends keyof PlanForm>(k: K, v: PlanForm[K]) => {
    setForm((f) => (f ? { ...f, [k]: v } : f));
    setFormError(null);
  };

  const dirty = useMemo(() => !!form && (!plan || JSON.stringify(form) !== JSON.stringify(formFromPlan(plan))), [form, plan]);
  const zones = useMemo(() => timeZones(form?.timeZone ?? browserTz), [form?.timeZone, browserTz]);

  const addAttendee = (raw: string) => {
    const name = raw.trim();
    if (!name || !form) return;
    const match = people.find((p) => p.name.toLowerCase() === name.toLowerCase());
    const next: AttendeeForm = match
      ? { stakeholderId: match.id, name: match.name, email: match.email ?? "", designation: match.designation ?? "" }
      : { stakeholderId: null, name, email: "", designation: "" };
    const dup = form.attendees.some((a) => (next.stakeholderId && a.stakeholderId === next.stakeholderId) || a.name.toLowerCase() === next.name.toLowerCase());
    if (dup) toast(`${next.name} is already on the list`, "neutral");
    else set("attendees", [...form.attendees, next]);
    setAttName("");
  };

  const save = async () => {
    if (!form) return;
    setFormError(null);
    const p = payloadFromForm(form);
    if (!p.ok) {
      setFormError(p.error);
      return;
    }
    setSaving(true);
    try {
      let seriesId = form.seriesId;
      if (seriesId === NEW_SERIES) {
        const sr = await fetch("/api/series", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: newSeriesTitle.trim() || form.title.trim(),
            cadence: newSeriesCadence,
            defaultDurationMin: form.durationMin,
            defaultVenue: form.venue.trim() || null,
            defaultCallUrl: form.callUrl.trim() || null,
          }),
        });
        if (!sr.ok) {
          setFormError(await errorOf(sr, "Couldn't save the series."));
          return;
        }
        seriesId = ((await sr.json()) as { series: SeriesDTO }).series.id;
      }
      const body = { ...p.body, seriesId: seriesId || null };
      const res = await fetch(plan ? `/api/plans/${plan.id}` : "/api/plans", {
        method: plan ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setFormError(await errorOf(res, "Couldn't save. Try again."));
        return;
      }
      const saved = ((await res.json()) as { plan: PlanDTO }).plan;
      toast("Saved", "success");
      if (!plan) {
        router.replace(`/plan?id=${saved.id}`);
      } else {
        setPlan(saved);
        setForm(formFromPlan(saved));
        void reloadCal();
        if (seriesId !== form.seriesId) {
          const sr = await fetch("/api/series", { cache: "no-store" }).catch(() => null);
          const sj = sr?.ok ? ((await sr.json().catch(() => null)) as { series?: SeriesDTO[] } | null) : null;
          if (sj?.series) setSeries(sj.series);
        }
      }
    } catch {
      setFormError("Couldn't reach the server. Check the connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (status: "PLANNED" | "CANCELLED") => {
    if (!plan) return;
    setBusy("status");
    try {
      const res = await fetch(`/api/plans/${plan.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        toast(await errorOf(res, "Couldn't update the meeting."), "danger");
        return;
      }
      const saved = ((await res.json()) as { plan: PlanDTO }).plan;
      setPlan(saved);
      setConfirmCancel(false);
      toast(status === "CANCELLED" ? "Meeting cancelled" : "Meeting restored", "success");
      void reloadCal();
    } catch {
      toast("Couldn't reach the server. Try again.", "danger");
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!plan) return;
    setBusy("delete");
    try {
      const res = await fetch(`/api/plans/${plan.id}`, { method: "DELETE" });
      if (!res.ok) {
        toast(await errorOf(res, "Couldn't delete the meeting."), "danger");
        return;
      }
      toast("Meeting deleted", "success");
      navBack(router, "/meetings");
    } catch {
      toast("Couldn't reach the server. Try again.", "danger");
    } finally {
      setBusy(null);
    }
  };

  const join = async () => {
    if (!plan?.callUrl) return;
    const r = await openCallLink(plan.callUrl);
    if (r === "copied") toast("Couldn't open it here. Link copied instead.", "neutral");
    else if (r === "invalid") toast("This link can't be opened.", "danger");
  };

  const addToCalendar = async () => {
    if (!plan) return;
    setBusy("ics");
    try {
      const r = await deliverPlanIcs(plan.id, plan.title);
      if (r === "ok") toast("Calendar file ready", "success");
    } catch {
      toast("Couldn't make the calendar file. Try again.", "danger");
    } finally {
      setBusy(null);
    }
  };

  const shareInvite = async () => {
    if (!plan) return;
    try {
      const r = await shareText(inviteText(plan), plan.title);
      if (r === "copied") toast("Sharing isn't available here. Invite copied instead.", "neutral");
    } catch {
      toast("Couldn't share the invite. Try again.", "danger");
    }
  };

  const sendInvites = async (mode: "invite" | "cancel") => {
    if (!plan) return;
    setBusy("invite");
    try {
      const res = await fetch(`/api/plans/${encodeURIComponent(plan.id)}/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
        if (j?.code === "email_not_configured") {
          setCalInfo((c) => (c ? { ...c, emailConfigured: false } : c));
          toast("Email isn't set up. Share the invite file instead.", "neutral");
        } else {
          toast(j?.error ?? "Couldn't send the invites. Try again.", "danger");
        }
        return;
      }
      const j = (await res.json()) as { sent: number; failed: string[]; kind: "invite" | "update" | "cancel" };
      const n = `${j.sent} ${j.sent === 1 ? "person" : "people"}`;
      toast(j.kind === "cancel" ? `Cancellation sent to ${n}` : j.kind === "update" ? `Update sent to ${n}` : `Invite sent to ${n}`, "success");
      if (j.failed.length) toast(`Couldn't reach ${j.failed.join(", ")}`, "danger");
      await reloadCal();
    } catch {
      toast("Couldn't reach the server. Try again.", "danger");
    } finally {
      setBusy(null);
    }
  };

  const planNext = async () => {
    if (!plan?.seriesId) return;
    setBusy("next");
    try {
      const res = await fetch(`/api/series/${plan.seriesId}/next`, { method: "POST" });
      if (!res.ok) {
        toast(await errorOf(res, "Couldn't plan the next meeting."), "danger");
        return;
      }
      const j = (await res.json()) as { plan: PlanDTO; existing?: boolean };
      toast(j.existing ? "The next one is already planned" : "Next meeting planned", "success");
      router.push(`/plan?id=${j.plan.id}`);
    } catch {
      toast("Couldn't reach the server. Try again.", "danger");
    } finally {
      setBusy(null);
    }
  };

  const back = (
    <Link
      href="/meetings"
      aria-label="Back to meetings"
      className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-btn px-2 text-meta font-semibold text-muted-foreground hover:text-foreground"
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navBack(router, "/meetings");
      }}
    >
      <ChevronLeft className="h-4 w-4" /> Meetings
    </Link>
  );

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl">
        {back}
        <div role="status" aria-busy="true" className="mt-3 space-y-3">
          <span className="sr-only">Loading</span>
          <div className="h-40 animate-pulse rounded-panel bg-muted" />
          <div className="h-56 animate-pulse rounded-panel bg-muted" />
        </div>
      </div>
    );
  }
  if (loadError || !form) {
    return (
      <div className="mx-auto max-w-2xl">
        {back}
        <Notice tone="danger" title="Couldn't open this meeting">
          <p>{loadError ?? "Something went wrong."}</p>
          <Button className="mt-3" onClick={() => void load()}>
            Try again
          </Button>
        </Notice>
      </div>
    );
  }

  const cancelled = plan?.status === "CANCELLED";
  const recorded = plan?.status === "RECORDED";
  const locked = cancelled || recorded;
  const chosenSeries = series.find((s) => s.id === form.seriesId);
  const durationChips = PLAN_DURATIONS.includes(form.durationMin as (typeof PLAN_DURATIONS)[number]) ? [...PLAN_DURATIONS] : [...PLAN_DURATIONS, form.durationMin].sort((a, b) => a - b);
  const needSave = dirty ? "Save your changes first" : undefined;
  const conflictText = conflictMessage(conflicts, form.timeZone);
  const withEmail = plan ? plan.attendees.filter((a) => a.email) : [];
  const invitedCount = calInfo ? Object.keys(calInfo.invited).length : 0;
  const label = plan && calInfo ? inviteLabel(plan.status, invitedCount > 0) : null;
  const canInvite = !!label && (label === "Send cancellation" || withEmail.length > 0);

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <header>
        {back}
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{plan ? "Planned meeting" : "Plan a meeting"}</h1>
          {cancelled && <Badge tone="danger">Cancelled</Badge>}
          {recorded && <Badge tone="success">Recorded</Badge>}
          {plan?.bookingId && <Badge tone="neutral">From a booking</Badge>}
        </div>
      </header>

      {offline && (
        <Notice tone="warning" icon={<CloudOff className="h-4 w-4" aria-hidden />} title="Planning needs internet">
          Connect to the internet to save or change a planned meeting. You can still record from one.
        </Notice>
      )}

      {recorded && plan?.meetingId && (
        <Notice tone="success" title="This meeting has been recorded">
          <Link href={`/meeting?id=${plan.meetingId}`} className="font-semibold text-accent underline underline-offset-2">
            Open the recording
          </Link>
        </Notice>
      )}

      <Panel>
        <PanelHeader title="Details" />
        <div className="space-y-4 p-4">
          <Field id="plan-title" label="Title">
            <input id="plan-title" value={form.title} maxLength={200} onChange={(e) => set("title", e.target.value)} placeholder="Weekly review" className={inputCls} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="plan-date" label="Date">
              <input id="plan-date" type="date" value={form.date} onChange={(e) => set("date", e.target.value)} className={inputCls} />
            </Field>
            <Field id="plan-time" label="Time">
              <input id="plan-time" type="time" value={form.time} onChange={(e) => set("time", e.target.value)} className={inputCls} />
            </Field>
          </div>
          <div>
            <p className="mb-1.5 text-meta font-semibold">Length</p>
            <div role="group" aria-label="Meeting length" className="flex flex-wrap gap-2">
              {durationChips.map((d) => (
                <button key={d} type="button" aria-pressed={form.durationMin === d} onClick={() => set("durationMin", d)} className={chipCls(form.durationMin === d)}>
                  {d} min
                </button>
              ))}
            </div>
          </div>
          {conflictText && (
            <p role="status" className="flex items-start gap-2 rounded-chip border border-warning/30 bg-warning-soft px-3 py-2 text-ui">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
              <span>
                {conflictText}. <span className="text-muted-foreground">You can still save.</span>
              </span>
            </p>
          )}
          {calReady && !locked && !offline && (
            <FindATime
              planId={plan?.id}
              attendees={form.attendees}
              durationMin={form.durationMin}
              timeZone={form.timeZone}
              onPick={(date, time) => setForm((f) => (f ? { ...f, date, time } : f))}
            />
          )}
          <div>
            <p className="text-meta text-muted-foreground">
              Times in {form.timeZone.replace(/_/g, " ")} ·{" "}
              <button type="button" className="font-semibold text-accent" onClick={() => setEditingTz((v) => !v)} aria-expanded={editingTz}>
                Change
              </button>
            </p>
            {editingTz && (
              <div className="mt-2 space-y-1">
                <label htmlFor="plan-tz" className="sr-only">
                  Time zone
                </label>
                <select id="plan-tz" value={form.timeZone} onChange={(e) => set("timeZone", e.target.value)} className={selectCls}>
                  {zones.map((z) => (
                    <option key={z} value={z}>
                      {z.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
                {form.timeZone !== browserTz && (
                  <button type="button" className="text-meta font-semibold text-accent" onClick={() => set("timeZone", browserTz)}>
                    Use this device&apos;s zone ({browserTz.replace(/_/g, " ")})
                  </button>
                )}
              </div>
            )}
          </div>
          <Field id="plan-venue" label="Venue">
            <input id="plan-venue" value={form.venue} maxLength={200} onChange={(e) => set("venue", e.target.value)} placeholder="Boardroom, 3rd floor" className={inputCls} />
          </Field>
          <Field id="plan-url" label="Call link" hint="Meet, Teams or Zoom. Must start with https://">
            <input id="plan-url" type="url" inputMode="url" autoCapitalize="none" value={form.callUrl} maxLength={500} onChange={(e) => set("callUrl", e.target.value)} placeholder="https://meet.google.com/..." className={inputCls} />
          </Field>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Attendees" meta={form.attendees.length ? String(form.attendees.length) : undefined} />
        <div className="space-y-3 p-4">
          {form.attendees.length > 0 && (
            <ul className="flex flex-wrap gap-2" aria-label="Attendees">
              {form.attendees.map((a, i) => (
                <li key={`${a.stakeholderId ?? a.name}-${i}`} className="flex min-h-11 items-center gap-1 rounded-chip bg-muted pl-3 pr-1 text-ui">
                  <span className="min-w-0">
                    <span className="font-semibold">{a.name}</span>
                    {a.designation && <span className="ml-1.5 text-meta text-muted-foreground">{a.designation}</span>}
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${a.name}`}
                    onClick={() => set("attendees", form.attendees.filter((_, j) => j !== i))}
                    className="grid h-10 w-10 place-items-center rounded-full text-muted-foreground hover:bg-card hover:text-foreground"
                  >
                    <X className="h-4 w-4" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <label htmlFor="plan-att" className="sr-only">
                Add an attendee
              </label>
              <PersonPicker
                id="plan-att"
                value={attName}
                onChange={setAttName}
                onCommit={addAttendee}
                placeholder="Add a person"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addAttendee(attName);
                  }
                }}
              />
            </div>
            <Button variant="secondary" onClick={() => addAttendee(attName)} disabled={!attName.trim()}>
              Add
            </Button>
          </div>
        </div>
      </Panel>

      <Panel>
        <PanelHeader title="Agenda" />
        <div className="p-4">
          <label htmlFor="plan-agenda" className="sr-only">
            Agenda
          </label>
          <textarea
            id="plan-agenda"
            value={form.agenda}
            maxLength={8000}
            rows={6}
            onChange={(e) => set("agenda", e.target.value)}
            placeholder={"1. Budget\n2. Hiring\n3. Next steps"}
            className={cx(inputCls, "min-h-36 py-3")}
          />
        </div>
      </Panel>

      {plan && plan.status !== "CANCELLED" && (
        <PreworkSection planId={plan.id} agenda={form.agenda} onAgenda={(next) => set("agenda", next)} offline={offline} />
      )}

      <Panel>
        <PanelHeader title="Series" />
        <div className="space-y-3 p-4">
          <div>
            <label htmlFor="plan-series" className="sr-only">
              Series
            </label>
            <select id="plan-series" value={form.seriesId} onChange={(e) => set("seriesId", e.target.value)} className={selectCls}>
              <option value="">None</option>
              {series.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title} · {CADENCE_LABEL[s.cadence].toLowerCase()}
                </option>
              ))}
              {plan?.series && !series.some((s) => s.id === plan.series?.id) && <option value={plan.series.id}>{plan.series.title}</option>}
              <option value={NEW_SERIES}>New series…</option>
            </select>
          </div>
          {form.seriesId === NEW_SERIES && (
            <div className="space-y-3">
              <Field id="plan-series-title" label="Series name" hint="Leave empty to use the meeting title">
                <input id="plan-series-title" value={newSeriesTitle} maxLength={200} onChange={(e) => setNewSeriesTitle(e.target.value)} placeholder={form.title || "Weekly review"} className={inputCls} />
              </Field>
              <div>
                <p className="mb-1.5 text-meta font-semibold">Repeats</p>
                <div role="group" aria-label="How often it repeats" className="flex flex-wrap gap-2">
                  {CADENCES.map((c) => (
                    <button key={c} type="button" aria-pressed={newSeriesCadence === c} onClick={() => setNewSeriesCadence(c)} className={chipCls(newSeriesCadence === c)}>
                      {CADENCE_LABEL[c]}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
          {chosenSeries && form.seriesId !== NEW_SERIES && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-meta text-muted-foreground">{CADENCE_LABEL[chosenSeries.cadence]}</p>
              <Button icon={<Settings2 className="h-4 w-4" aria-hidden />} onClick={() => setSeriesSheet(true)}>
                Series settings
              </Button>
            </div>
          )}
        </div>
      </Panel>

      {plan?.seriesId && form.seriesId === plan.seriesId && <SeriesProgressCard seriesId={plan.seriesId} />}

      <div className="sticky bottom-[calc(92px+var(--safe-area-inset-bottom,env(safe-area-inset-bottom)))] z-10 space-y-2 lg:static">
        {formError && (
          <p className="rounded-chip bg-card px-3 py-2 text-meta text-danger shadow-card" role="alert">
            {formError}
          </p>
        )}
        <Button variant="primary" size="lg" loading={saving} disabled={offline || recorded || (!!plan && !dirty)} onClick={() => void save()} className="w-full sm:w-auto sm:min-w-40">
          {plan ? "Save" : "Save meeting"}
        </Button>
      </div>

      {plan && (
        <Panel>
          <PanelHeader title="Actions" />
          <div className="space-y-3 p-4">
            {needSave && <p className="text-meta text-muted-foreground">{needSave}</p>}
            <div className="flex flex-wrap gap-2">
              {!locked && (
                <Link
                  href={recordHref(plan)}
                  aria-disabled={dirty}
                  onClick={(e) => dirty && e.preventDefault()}
                  className={cx(
                    "inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-accent px-5 text-ui font-semibold text-accent-foreground shadow-[0_4px_14px_-6px_var(--accent)] hover:bg-accent/90 lg:min-h-10",
                    dirty && "pointer-events-none opacity-50"
                  )}
                >
                  <Mic className="h-4 w-4" aria-hidden /> Record now
                </Link>
              )}
              {plan.callUrl && (
                <Button icon={<Phone className="h-4 w-4" aria-hidden />} disabled={dirty} onClick={() => void join()}>
                  Join call
                </Button>
              )}
              <Button icon={<CalendarPlus className="h-4 w-4" aria-hidden />} loading={busy === "ics"} disabled={dirty || offline} onClick={() => void addToCalendar()}>
                Add to calendar
              </Button>
              <Button icon={<Share2 className="h-4 w-4" aria-hidden />} disabled={dirty} onClick={() => void shareInvite()}>
                Share invite
              </Button>
              {canInvite && calInfo && (
                calInfo.emailConfigured ? (
                  <Button
                    variant={label === "Send cancellation" ? "danger" : "secondary"}
                    icon={<Mail className="h-4 w-4" aria-hidden />}
                    loading={busy === "invite"}
                    disabled={dirty || offline}
                    onClick={() => void sendInvites(label === "Send cancellation" ? "cancel" : "invite")}
                  >
                    {label}
                  </Button>
                ) : (
                  <Button icon={<Share2 className="h-4 w-4" aria-hidden />} loading={busy === "ics"} disabled={dirty || offline} onClick={() => void addToCalendar()}>
                    Share invite file
                  </Button>
                )
              )}
              {plan.seriesId && (
                <Button icon={<Repeat className="h-4 w-4" aria-hidden />} loading={busy === "next"} disabled={offline} onClick={() => void planNext()}>
                  Plan next in series
                </Button>
              )}
            </div>
            {canInvite && calInfo && (
              <p className="text-meta text-muted-foreground" aria-live="polite">
                {calInfo.emailConfigured
                  ? label === "Send cancellation"
                    ? `${invitedCount} ${invitedCount === 1 ? "person was" : "people were"} invited by email. Tell them it's cancelled.`
                    : `${withEmail.length} of ${plan.attendees.length} attendees have an email${invitedCount ? `, ${invitedCount} already invited` : ""}.${withEmail.length < plan.attendees.length ? " Add an email to invite the rest." : ""}`
                  : "Email isn't set up. Share the invite file instead."}
              </p>
            )}
            {!recorded && (
              <div className="flex flex-wrap items-center gap-2 border-t border-border/70 pt-3">
                {cancelled ? (
                  <>
                    <Button loading={busy === "status"} disabled={offline} onClick={() => void setStatus("PLANNED")}>
                      Restore meeting
                    </Button>
                    {confirmDelete ? (
                      <>
                        <Button variant="danger-solid" loading={busy === "delete"} disabled={offline} onClick={() => void remove()}>
                          Confirm delete
                        </Button>
                        <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
                          Keep
                        </Button>
                      </>
                    ) : (
                      <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                        Delete
                      </Button>
                    )}
                  </>
                ) : confirmCancel ? (
                  <>
                    <Button variant="danger-solid" loading={busy === "status"} disabled={offline} onClick={() => void setStatus("CANCELLED")}>
                      Confirm cancel
                    </Button>
                    <Button variant="ghost" onClick={() => setConfirmCancel(false)}>
                      Keep
                    </Button>
                  </>
                ) : (
                  <Button variant="danger" disabled={offline} onClick={() => setConfirmCancel(true)}>
                    Cancel meeting
                  </Button>
                )}
              </div>
            )}
          </div>
        </Panel>
      )}
      {seriesSheet && chosenSeries && (
        <SeriesSettingsSheet
          series={chosenSeries}
          calendarOn={calReady}
          offline={offline}
          onChanged={(next) => setSeries((list) => list.map((x) => (x.id === next.id ? next : x)))}
          onClose={() => setSeriesSheet(false)}
        />
      )}
    </div>
  );
}
