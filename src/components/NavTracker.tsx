"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { recordPath } from "@/lib/navStack";

export function NavTracker(): null {
  const pathname = usePathname();
  useEffect(() => {
    recordPath(pathname);
  }, [pathname]);
  return null;
}
