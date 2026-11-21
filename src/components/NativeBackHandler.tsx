"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getApp, hasPlugin } from "@/lib/native";
import { closeTopOverlay } from "@/lib/overlays";
import { ROOT_ROUTES, navBack, parentOf } from "@/lib/navStack";
import { isRecordingActive } from "@/lib/recordingFlag";

export function NativeBackHandler(): null {
  const router = useRouter();
  const pathname = usePathname();
  const pathRef = useRef(pathname);
  pathRef.current = pathname;

  useEffect(() => {
    if (!hasPlugin("App")) return;
    let dead = false;
    let handle: { remove: () => Promise<void> } | null = null;
    getApp()
      .then(async (App) => {
        const h = await App.addListener("backButton", async () => {
          try {
            if (closeTopOverlay()) return;
            const path = pathRef.current;
            if ((ROOT_ROUTES as readonly string[]).includes(path)) {
              if (await isRecordingActive()) await App.minimizeApp();
              else await App.exitApp();
            } else {
              navBack(router, parentOf(path));
            }
          } catch (e) {
            console.warn("backButton handler failed", e);
          }
        });
        if (dead) void h.remove();
        else handle = h;
      })
      .catch((e) => console.warn("App plugin unavailable", e));
    return () => {
      dead = true;
      if (handle) void handle.remove();
    };
  }, [router]);

  return null;
}
