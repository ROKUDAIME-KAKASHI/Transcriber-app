"use client";

import type { ReactNode } from "react";
import { useFlag } from "@/lib/flagsClient";
import { ScheduleSettings } from "./ScheduleSettings";

/** The calendar while its switch is on; with it off, the plain Schedule page as it was. */
export function ScheduleCalendarGate({ calendar }: { calendar: ReactNode }) {
  const on = useFlag("calendarView");
  return on ? <>{calendar}</> : <ScheduleSettings />;
}
