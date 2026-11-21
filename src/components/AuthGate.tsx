"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { WifiOff } from "lucide-react";
import { decideAuth } from "@/lib/authCore";
import { useAuth } from "./AuthProvider";
import { Button, Panel } from "./ui";

function Skeleton() {
  return (
    <div role="status" aria-busy="true" className="min-h-dvh">
      <span className="sr-only">Loading</span>
      <div className="fixed inset-y-0 left-0 hidden w-60 border-r border-border bg-card lg:block" />
      <div className="sticky top-0 h-14 border-b border-border bg-card lg:hidden" />
      <div className="mx-auto w-full max-w-6xl space-y-3 px-4 pt-5 sm:px-6 lg:pl-72 lg:pr-10 lg:pt-10">
        <div className="h-24 animate-pulse rounded-panel bg-muted" />
        <div className="h-24 animate-pulse rounded-panel bg-muted" />
        <div className="h-24 animate-pulse rounded-panel bg-muted" />
      </div>
      <div className="fixed inset-x-0 bottom-0 h-14 border-t border-border bg-card lg:hidden" />
    </div>
  );
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { probe, cachedUser, probing, recheck } = useAuth();
  const router = useRouter();
  const [waitedMs, setWaitedMs] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setWaitedMs(7000), 7000);
    return () => clearTimeout(t);
  }, []);

  const decision = decideAuth({ probe, cached: !!cachedUser, waitedMs });

  useEffect(() => {
    // Only a reachable server answering "no session" sends the user to /login; local data is kept.
    if (decision === "redirect-login") router.replace("/login");
  }, [decision, router]);

  if (decision === "app" || decision === "app-cached") return <>{children}</>;
  if (decision === "needs-internet") {
    return (
      <div className="grid min-h-dvh place-items-center px-4">
        <Panel as="div" className="w-full max-w-sm p-6 text-center">
          <WifiOff size={24} className="mx-auto text-muted-foreground" aria-hidden />
          <h1 className="mt-3 text-lg font-semibold">Sign in needs internet once</h1>
          <p className="mt-1.5 text-ui text-muted-foreground">
            Connect to the internet, then sign in. After that the app works offline.
          </p>
          <Button variant="secondary" loading={probing} onClick={recheck} className="mt-5 w-full">
            Try again
          </Button>
        </Panel>
      </div>
    );
  }
  return <Skeleton />;
}
