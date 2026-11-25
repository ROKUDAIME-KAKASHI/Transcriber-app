"use client";

import { useEffect, useState } from "react";
import { useFlag } from "@/lib/flagsClient";
import { desktopChromiumNow, useScreenNamingOptIn } from "@/lib/naming/client";
import { Switch } from "./ui";

/** True on a laptop Chromium browser (checked after mount, so the server render and the first paint agree). */
export function useScreenNamingAvailable(): boolean {
  const flag = useFlag("screenNaming");
  const [capable, setCapable] = useState(false);
  useEffect(() => setCapable(desktopChromiumNow()), []);
  return flag && capable;
}

export const SCREEN_NAMING_LABEL = "Read names from the call screen (beta)";
export const SCREEN_NAMING_NOTE =
  "On a laptop, when you record an online call, Minutely looks at the name shown on the speaker's tile and uses it for that voice. It happens on this device. Pictures are never saved or sent anywhere, only the names are kept. Fix any wrong name with one tap.";

/** Per-device switch for the beta. Renders nothing where the feature can't run (apps, phones, other browsers, switched off). */
export function ScreenNamingToggle({ className }: { className?: string }) {
  const available = useScreenNamingAvailable();
  const [on, setOn] = useScreenNamingOptIn();
  if (!available) return null;
  return (
    <div className={className}>
      <Switch label={SCREEN_NAMING_LABEL} description={SCREEN_NAMING_NOTE} checked={on} onChange={setOn} />
    </div>
  );
}
