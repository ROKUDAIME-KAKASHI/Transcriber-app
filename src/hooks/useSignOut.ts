"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { markSignedOut } from "@/components/SyncProvider";

/** Signs out through NextAuth, forgets the local user only after the server confirmed, then goes to /login. */
export function useSignOut(): () => void {
  const router = useRouter();
  return useCallback(() => {
    void signOut({ redirect: false })
      .then(() => {
        markSignedOut();
        router.replace("/login");
      })
      .catch(() => {
        /* sign-out failed (flaky network): stay signed in with sync untouched */
      });
  }, [router]);
}
