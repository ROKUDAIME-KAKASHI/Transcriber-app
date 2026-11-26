"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { markSignedOut } from "@/components/SyncProvider";
import { useToast } from "@/components/Toast";
import { useRecorderActions } from "@/components/RecorderProvider";
import { isRecordingActive } from "@/lib/recordingFlag";
import { cacheDisplayName } from "@/lib/displayName";

/** Signs out through NextAuth, forgets the local user only after the server confirmed, then goes to /login. */
export function useSignOut(): () => void {
  const router = useRouter();
  const toast = useToast();
  const recorder = useRecorderActions();
  return useCallback(() => {
    // Signing out would drop the sign-in a running recording saves with: finish it first. This covers the
    // app-level recorder (starting, recording, saving) and the Android cloud service (asked directly).
    void (async () => {
      if (recorder?.isBusy() || (await isRecordingActive().catch(() => true))) {
        toast("Stop the recording before signing out.", "danger");
        return;
      }
      await signOut({ redirect: false })
      .then(() => {
        markSignedOut();
        cacheDisplayName(""); // the next person on this device must not inherit this name
        router.replace("/login");
      })
      .catch(() => {
        // Sign-out failed (flaky network): stay signed in with sync untouched, and say so.
        toast("Couldn't sign out. Try again.", "danger");
      });
    })();
  }, [router, toast, recorder]);
}
