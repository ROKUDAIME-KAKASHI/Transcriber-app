import { Suspense } from "react";
import { MeetingLoader, MeetingSkeleton } from "@/components/MeetingLoader";

export default function MeetingPage() {
  return (
    <Suspense fallback={<MeetingSkeleton />}>
      <MeetingLoader />
    </Suspense>
  );
}
