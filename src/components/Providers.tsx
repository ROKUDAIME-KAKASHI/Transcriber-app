"use client";

import { useEffect } from "react";
import { AuthProvider } from "./AuthProvider";
import { SyncProvider } from "./SyncProvider";
import { NavTracker } from "./NavTracker";
import { NativeBackHandler } from "./NativeBackHandler";
import { ServiceWorkerManager } from "./ServiceWorkerManager";
import { AutoMinutesRunner } from "./AutoMinutesRunner";
import { ToastProvider } from "./Toast";
import { ErrorBoundary, ErrorReporter } from "./ErrorReporter";
import { cleanupOldExports } from "@/lib/native";

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    void cleanupOldExports();
  }, []);

  return (
    <AuthProvider>
      <SyncProvider>
        <ToastProvider>
          <NavTracker />
          <NativeBackHandler />
          <ServiceWorkerManager />
          <AutoMinutesRunner />
          <ErrorReporter />
          <ErrorBoundary>{children}</ErrorBoundary>
        </ToastProvider>
      </SyncProvider>
    </AuthProvider>
  );
}
