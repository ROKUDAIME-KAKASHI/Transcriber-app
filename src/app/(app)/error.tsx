"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/clientErrors";

/**
 * A render error in any signed-in page lands here, inside the (app) layout. The recorder lives in that
 * layout, so a running recording is untouched: "Try again" re-renders the page without a reload.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportClientError("boundary", error);
  }, [error]);

  return (
    <div className="grid min-h-[60dvh] place-items-center p-6">
      <div className="w-full max-w-sm rounded-panel border border-border/70 bg-card p-6 text-center">
        <h1 className="text-ui font-semibold">Something went wrong</h1>
        <p className="mt-1 text-meta text-muted-foreground">
          This page hit a problem. A recording in progress is not affected.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-4 inline-flex min-h-11 items-center justify-center rounded-btn bg-accent px-5 text-ui font-semibold text-accent-foreground"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
