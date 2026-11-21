"use client";

import { Button, Notice } from "@/components/ui";

export type UpdateNoticeMode = "ready" | "ready-recording" | "chunk-error";

export function UpdateNotice({ mode, onReload, onDismiss }: { mode: UpdateNoticeMode; onReload: () => void; onDismiss: () => void }) {
  const title = mode === "chunk-error" ? "Update needed" : "Update ready";
  return (
    <div role="status" className="fixed inset-x-4 bottom-20 z-50 lg:inset-x-auto lg:bottom-4 lg:right-4 lg:w-80">
      <div className="rounded-xl bg-card shadow-lg">
        <Notice title={title}>
          {mode === "ready" && "Reload to get the latest version."}
          {mode === "ready-recording" && "It will install the next time you open the app."}
          {mode === "chunk-error" && "Part of the app couldn't load. Finish recording, then reload."}
          <div className="mt-2 flex gap-2">
            {mode === "ready" ? (
              <>
                <Button variant="primary" className="min-h-11" onClick={onReload}>
                  Reload to update
                </Button>
                <Button variant="ghost" onClick={onDismiss}>
                  Later
                </Button>
              </>
            ) : (
              <Button variant="ghost" onClick={onDismiss}>
                Dismiss
              </Button>
            )}
          </div>
        </Notice>
      </div>
    </div>
  );
}
