"use client";

import { useCallback, useState, type ReactNode } from "react";
import { Copy } from "lucide-react";
import { Dialog } from "./MeetingRowActions";
import { Button } from "./ui";
import { useToast } from "./Toast";
import { hasConsented, setConsented } from "@/lib/consent";
import { CONSENT_NOTE, consentDetail, type ConsentEngine } from "@/lib/privacyCore";

/** Copies the consent note. Shared by the dialog and Profile → Recording. */
export async function copyConsentNote(): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(CONSENT_NOTE);
    return true;
  } catch {
    return false;
  }
}

function ConsentDialog({ engine, onStart, onClose }: { engine: ConsentEngine; onStart: () => void; onClose: () => void }) {
  const toast = useToast();
  return (
    <Dialog label="Recording others" onClose={onClose}>
      <h2 className="text-ui font-semibold">Recording others? Let them know first.</h2>
      <p className="mt-1.5 text-meta text-muted-foreground">{consentDetail(engine)}</p>
      <div className="mt-4 flex flex-col gap-2">
        <Button variant="primary" onClick={onStart}>
          I&apos;ll tell them, start
        </Button>
        <Button
          variant="secondary"
          icon={<Copy className="h-4 w-4" aria-hidden />}
          onClick={async () => toast((await copyConsentNote()) ? "Consent note copied" : "Couldn't copy the note", "neutral")}
        >
          Copy consent note
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Dialog>
  );
}

/**
 * The first recording on a device asks "did you tell them?" once. After that gate() just runs the start
 * straight away, so a later recording is never delayed. Only the Record screen's own buttons use it:
 * native auto-resume and recovery never go through here.
 */
export function useConsentGate(engine: ConsentEngine): { gate: (start: () => void) => void; dialog: ReactNode } {
  const [pending, setPending] = useState<(() => void) | null>(null);
  const gate = useCallback((start: () => void) => {
    if (hasConsented()) start();
    else setPending(() => start);
  }, []);
  const dialog = pending ? (
    <ConsentDialog
      engine={engine}
      onClose={() => setPending(null)}
      onStart={() => {
        setConsented();
        const go = pending;
        setPending(null);
        go();
      }}
    />
  ) : null;
  return { gate, dialog };
}
