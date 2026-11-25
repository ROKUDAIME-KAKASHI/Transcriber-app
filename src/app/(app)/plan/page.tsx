import { Suspense } from "react";
import { FlagGate } from "@/components/FlagGate";
import { PlanPage } from "@/components/PlanPage";

export default function Page() {
  return (
    <FlagGate flag="plannedMeetings" title="Planning is paused">
      <Suspense fallback={null}>
        <PlanPage />
      </Suspense>
    </FlagGate>
  );
}
