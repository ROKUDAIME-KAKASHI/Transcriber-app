import { AppShell } from "@/components/AppShell";
import { AuthGate } from "@/components/AuthGate";
import { RecorderProvider } from "@/components/RecorderProvider";

// The recorder sits above the auth gate: a session blip can swap the gate's content, never the recorder.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <RecorderProvider>
      <AuthGate>
        <AppShell>{children}</AppShell>
      </AuthGate>
    </RecorderProvider>
  );
}
