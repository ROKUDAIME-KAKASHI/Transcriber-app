import { FlagGate } from "@/components/FlagGate";
import { TaskTracker } from "@/components/TaskTracker";

export default function TasksPage() {
  return (
    <FlagGate flag="taskTracker" title="Tasks are paused">
      <TaskTracker />
    </FlagGate>
  );
}
