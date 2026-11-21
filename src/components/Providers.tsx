"use client";

import { useEffect } from "react";
import { SessionProvider } from "next-auth/react";
import { NavTracker } from "./NavTracker";

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  return (
    <SessionProvider>
      <NavTracker />
      {children}
    </SessionProvider>
  );
}
