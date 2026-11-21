"use client";

import { useEffect } from "react";
import { AuthProvider } from "./AuthProvider";
import { SyncProvider } from "./SyncProvider";
import { NavTracker } from "./NavTracker";
import { NativeBackHandler } from "./NativeBackHandler";
import { ServiceWorkerManager } from "./ServiceWorkerManager";
import { cleanupOldExports } from "@/lib/native";

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    void cleanupOldExports();
  }, []);

  return (
    <AuthProvider>
      <SyncProvider>
        <NavTracker />
        <NativeBackHandler />
        <ServiceWorkerManager />
        {children}
      </SyncProvider>
    </AuthProvider>
  );
}
