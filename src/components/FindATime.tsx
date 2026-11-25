"use client";

import { useMemo, useState } from "react";
import { CalendarClock, UserRound } from "lucide-react";
import { Button, Notice, cx } from "./ui";
import { suggestTimes, type Suggestions } from "@/lib/calendarClient";
import { formFieldsAt } from "@/lib/calendar";
import { formatInZone } from "@/lib/scheduling";
import type { AttendeeForm } from "@/lib/planning";

/**
 * "Find a time": up to six slots in the next 14 days when you and every attendee who shares their
 * availability are free. Tapping one fills the date and time. Attendees we can't see are listed, never guessed.
 */
export function FindATime({
  planId,
  attendees,
  durationMin,
  timeZone,
  disabled,
  onPick,
}: {
  planId?: string;
  attendees: AttendeeForm[];
  durationMin: number;
  timeZone: string;
  disabled?: boolean;
  onPick: (date: string, time: string) => void;
}) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [result, setResult] = useState<Suggestions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<number | null>(null);

  const browserTz = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      return "UTC";
    }
  }, []);

  const find = async () => {
    setState("loading");
    setError(null);
    setPicked(null);
    const r = await suggestTimes({
      attendees: attendees.map((a) => ({ name: a.name, email: a.email })),
      durationMin,
      excludePlanId: planId,
      fallbackTz: browserTz,
      displayTz: timeZone,
    });
    if (!r.ok) {
      setError(r.error);
      setState("error");
      return;
    }
    setResult(r.data);
    setState("done");
  };

  return (
    <div className="rounded-chip border border-border/70 bg-muted/30 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-ui font-semibold">Find a time</p>
          <p className="text-meta text-muted-foreground">
            Free for you and the people who share their calendar, in the next 14 days.
          </p>
        </div>
        <Button
          icon={<CalendarClock className="h-4 w-4" aria-hidden />}
          loading={state === "loading"}
          disabled={disabled}
          onClick={() => void find()}
        >
          {state === "done" ? "Search again" : "Find a time"}
        </Button>
      </div>

      <div aria-live="polite" className="mt-3 space-y-3 empty:mt-0">
        {state === "error" && (
          <Notice tone="warning" title="Couldn't look for a time">
            {error}
          </Notice>
        )}
        {state === "done" && result && (
          <>
            {result.slots.length === 0 ? (
              <p className="text-ui text-muted-foreground">
                No common free time in the next 14 days for {durationMin} minutes. Try a shorter meeting.
              </p>
            ) : (
              <ul className="flex flex-wrap gap-2" aria-label="Suggested times">
                {result.slots.map((s, i) => (
                  <li key={s.startMs}>
                    <button
                      type="button"
                      aria-pressed={picked === i}
                      onClick={() => {
                        const f = formFieldsAt(s.startMs, timeZone);
                        onPick(f.date, f.time);
                        setPicked(i);
                      }}
                      className={cx(
                        "inline-flex min-h-12 items-center rounded-chip border px-3 text-ui font-semibold tabular-nums transition-colors lg:min-h-10",
                        picked === i ? "border-accent bg-accent text-accent-foreground" : "border-border/70 bg-card hover:bg-accent-soft"
                      )}
                    >
                      {formatInZone(new Date(s.startMs), timeZone)}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {result.unknownNames.length > 0 && (
              <p className="flex items-start gap-2 text-meta text-muted-foreground">
                <UserRound className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>
                  Availability unknown: {result.unknownNames.join(", ")}. They need a Minutely account, an email on this meeting and
                  sharing turned on in their Profile.
                </span>
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
