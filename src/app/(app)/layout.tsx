import { AppShell } from "@/components/AppShell";
import { AuthGate } from "@/components/AuthGate";
import { RecorderProvider } from "@/components/RecorderProvider";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate>
      <RecorderProvider>
        <AppShell>{children}</AppShell>
      </RecorderProvider>
    </AuthGate>
  );
}
