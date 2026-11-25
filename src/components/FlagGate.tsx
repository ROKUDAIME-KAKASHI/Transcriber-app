"use client";

import type { ReactNode } from "react";
import { useFlag } from "@/lib/flagsClient";
import type { FlagKey } from "@/lib/flagsCore";
import { Notice } from "./ui";

/** Renders children only while the feature is switched on; otherwise a short notice. */
export function FlagGate({ flag, title, children }: { flag: FlagKey; title: string; children: ReactNode }) {
  const on = useFlag(flag);
  if (on) return <>{children}</>;
  return (
    <div className="mx-auto w-full max-w-xl py-8">
      <Notice tone="warning" title={title}>The owner has paused this feature for now. Please check back later.</Notice>
    </div>
  );
}
