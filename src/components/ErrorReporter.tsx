"use client";

import { Component, useEffect, type ErrorInfo, type ReactNode } from "react";
import { initErrorVersion, reportClientError } from "@/lib/clientErrors";

/** Listens for uncaught errors and unhandled promise rejections and reports them (see lib/clientErrors.ts). */
export function ErrorReporter() {
  useEffect(() => {
    initErrorVersion();
    const onError = (ev: ErrorEvent) => reportClientError("error", ev.error ?? ev.message);
    const onRejection = (ev: PromiseRejectionEvent) => reportClientError("unhandledrejection", ev.reason);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}

/** Catches render errors in the app content and shows a friendly card instead of a blank screen. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    reportClientError("boundary", error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="grid min-h-dvh place-items-center p-6">
        <div className="w-full max-w-sm rounded-panel border border-border/70 bg-card p-6 text-center">
          <h1 className="text-ui font-semibold">Something went wrong</h1>
          <p className="mt-1 text-meta text-muted-foreground">
            Reloading usually fixes it.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 inline-flex min-h-11 items-center justify-center rounded-btn bg-accent px-5 text-ui font-semibold text-accent-foreground"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
