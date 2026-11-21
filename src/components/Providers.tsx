"use client";

import { useEffect } from "react";
import { SessionProvider } from "next-auth/react";
import { NavTracker } from "./NavTracker";
import { NativeBackHandler } from "./NativeBackHandler";
import { cleanupOldExports } from "@/lib/native";

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    void cleanupOldExports();
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  return (
    <SessionProvider>
      <NavTracker />
      <NativeBackHandler />
      {children}
    </SessionProvider>
  );
}
