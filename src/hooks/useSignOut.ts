"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { markSignedOut } from "@/components/SyncProvider";
import { useToast } from "@/components/Toast";
import { useRecorderActions } from "@/components/RecorderProvider";

/** Signs out through NextAuth, forgets the local user only after the server confirmed, then goes to /login. */
export function useSignOut(): () => void {
  const router = useRouter();
  const toast = useToast();
  const recorder = useRecorderActions();
  return useCallback(() => {
    // Signing out would drop the sign-in a running recording saves with: finish it first.
    if (recorder?.isBusy()) {
      toast("Stop the recording before signing out.", "danger");
      return;
    }
    void signOut({ redirect: false })
      .then(() => {
        markSignedOut();
        router.replace("/login");
      })
      .catch(() => {
        // Sign-out failed (flaky network): stay signed in with sync untouched, and say so.
        toast("Couldn't sign out. Try again.", "danger");
      });
  }, [router, toast, recorder]);
}
