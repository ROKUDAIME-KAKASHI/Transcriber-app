"use client";

import { useState } from "react";
import { ChevronDown, ExternalLink, MonitorSpeaker, TriangleAlert } from "lucide-react";
import {
  detectCallPlatform, guideHidden, openableCallUrl, setGuideHidden, shareProblemCopy, type ShareProblemCode,
} from "@/lib/guidedCall";
import type { PlatformId } from "@/lib/naming/highlight";
import { CallGuide } from "./CallGuide";
import { ScreenNamingToggle } from "./ScreenNamingToggle";
import { Button, Notice, inputCls } from "./ui";

/** The browser's saved-settings store, or null when it is blocked. */
function deviceStore(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * "Record an online call" (laptops). Shows a short picture guide, then the browser's share window, and can open
 * the call link first. `onStart` must run from the click so the browser lets the share window open.
 */
export function GuidedCall({
  disabled,
  startUrl,
  problem,
  onStart,
}: {
  disabled: boolean;
  /** A call link already known (from a planned meeting). */
  startUrl: string | null;
  /** What was wrong with the last share, if anything. */
  problem: ShareProblemCode | null;
  /** Starts the recording. Gets the call's platform when the pasted link shows it (used to find the speaker's tile). */
  onStart: (platform: PlatformId | null) => void;
}) {
  const [typed, setTyped] = useState<string | null>(null);
  // Closed until needed: the main record button stays the one big action. Opens by itself for a planned call or a problem.
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const [guide, setGuide] = useState<null | { opened: boolean; blocked: boolean }>(null);
  const text = typed ?? startUrl ?? "";
  const url = openableCallUrl(text);
  const platform = detectCallPlatform(text);
  const badLink = text.trim() !== "" && !url;
  const copy = problem ? shareProblemCopy(problem) : null;
  const open = !!copy || (userOpen ?? !!startUrl);

  const begin = () => {
    let opened = false;
    const blocked = false;
    if (url) {
      // Opened right here, in the click, so the browser doesn't treat it as an unwanted pop-up.
      // Through a link with noopener/noreferrer, so the call page can't reach this page or see its address.
      // The browser gives no answer about pop-up blocking this way, so the "allow pop-ups" hint stays visible.
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.click();
      opened = true;
    }
    const hidden = guideHidden(deviceStore());
    // Without a call to open, a switched-off guide goes straight to the share window. Otherwise the user
    // has to come back to this tab first, so a click here is needed anyway.
    if (hidden && !url) {
      onStart(platform?.id ?? null);
      return;
    }
    setGuide({ opened, blocked });
  };

  return (
    <>
    <details open={open} onToggle={(e) => setUserOpen(e.currentTarget.open)} className="group border-t border-border/70 px-4">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 py-2 text-meta font-semibold [&::-webkit-details-marker]:hidden">
        <span>
          Recording an online call?
          <span className="block font-normal text-muted-foreground">Google Meet, Teams or Zoom in your browser</span>
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="pb-4 pt-1">

      {copy && (
        <div className="mb-3" role="alert">
          <Notice tone="warning" icon={<TriangleAlert className="h-4 w-4" />} title={copy.title}>
            {copy.fix}
          </Notice>
          <Button className="mt-2 w-full" disabled={disabled} onClick={() => onStart(platform?.id ?? null)}>Try again</Button>
        </div>
      )}

      <input
        id="call-link"
        type="url"
        inputMode="url"
        autoComplete="off"
        placeholder="Paste the call link (optional)"
        value={text}
        disabled={disabled}
        onChange={(e) => setTyped(e.target.value)}
        className={`${inputCls} min-h-11`}
        aria-invalid={badLink || undefined}
        aria-describedby="call-link-note"
        aria-label="Call link"
      />
      <p id="call-link-note" className="mt-1.5 text-meta text-muted-foreground">
        {badLink
          ? "Use a link that starts with https://"
          : platform
            ? `${platform.name} link.${platform.hint ? ` ${platform.hint}` : ""}`
            : url
              ? "This link will open in a new tab."
              : "Or join the call yourself and press the button."}
      </p>

      <Button
        variant="secondary"
        className="mt-3 w-full"
        disabled={disabled || badLink}
        icon={url ? <ExternalLink className="h-4 w-4" aria-hidden /> : <MonitorSpeaker className="h-4 w-4" aria-hidden />}
        onClick={begin}
      >
        {url ? "Open call and record" : "Record an online call"}
      </Button>
      {url && (
        <p className="mt-1.5 text-meta text-muted-foreground">If nothing opens, allow pop-ups for this site and press again.</p>
      )}

      <ScreenNamingToggle className="mt-3" />
      </div>
    </details>

      {guide && (
        <CallGuide
          platform={platform}
          opened={guide.opened}
          popupBlocked={guide.blocked}
          compact={guideHidden(deviceStore())}
          onClose={() => setGuide(null)}
          onContinue={(dontShow) => {
            if (dontShow) setGuideHidden(deviceStore(), true);
            setGuide(null);
            onStart(platform?.id ?? null);
          }}
        />
      )}
    </>
  );
}
