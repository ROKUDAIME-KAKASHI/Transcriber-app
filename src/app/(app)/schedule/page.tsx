import { Suspense } from "react";
import { FlagGate } from "@/components/FlagGate";
import { ScheduleCalendar } from "@/components/ScheduleCalendar";
import { ScheduleCalendarGate } from "@/components/ScheduleCalendarGate";

export default function SchedulePage() {
  return (
    <FlagGate flag="scheduling" title="Scheduling is paused">
      <ScheduleCalendarGate
        calendar={
          <Suspense fallback={null}>
            <ScheduleCalendar />
          </Suspense>
        }
      />
    </FlagGate>
  );
}
