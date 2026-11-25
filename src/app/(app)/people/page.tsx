import { FlagGate } from "@/components/FlagGate";
import { PeoplePage } from "@/components/PeoplePage";

export default function Page() {
  return (
    <FlagGate flag="stakeholders" title="People are paused">
      <PeoplePage />
    </FlagGate>
  );
}
