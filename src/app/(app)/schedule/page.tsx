import { FlagGate } from "@/components/FlagGate";
import { ScheduleSettings } from "@/components/ScheduleSettings";

export default function SchedulePage() {
  return (
    <FlagGate flag="scheduling" title="Scheduling is paused">
      <ScheduleSettings />
    </FlagGate>
  );
}
