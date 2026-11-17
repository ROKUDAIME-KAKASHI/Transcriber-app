import { redirect } from "next/navigation";
import { getUserId } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { Recorder } from "@/components/Recorder";

export default async function RecordPage() {
  if (!(await getUserId())) redirect("/login");
  return (
    <AppShell>
      <Recorder />
    </AppShell>
  );
}
