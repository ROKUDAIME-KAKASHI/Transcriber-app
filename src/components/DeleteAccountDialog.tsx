"use client";

import { useState } from "react";
import { Dialog } from "./MeetingRowActions";
import { Button, FieldLabel, inputCls } from "./ui";
import { useDeleteAccount } from "@/hooks/useDeleteAccount";
import { DELETE_WORD, isDeleteConfirmed } from "@/lib/privacyCore";

/** Type DELETE to remove the account and everything in it. Cannot be undone. */
export function DeleteAccountDialog({ userId, onClose }: { userId: string | null; onClose: () => void }) {
  const run = useDeleteAccount(userId);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ok = isDeleteConfirmed(text);
  const submit = async () => {
    if (!ok || busy) return;
    setBusy(true);
    setError(null);
    const problem = await run();
    if (problem) {
      setError(problem);
      setBusy(false);
    }
  };
  return (
    <Dialog label="Delete account" onClose={busy ? () => {} : onClose}>
      <h2 className="text-ui font-semibold">Delete your account?</h2>
      <p className="mt-1.5 text-meta text-muted-foreground">
        This permanently removes your meetings, transcripts, minutes, tasks, people, plans, bookings and availability, on the server
        and on this device. It cannot be undone.
      </p>
      <form
        className="mt-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <FieldLabel htmlFor="delete-confirm">Type {DELETE_WORD} to confirm</FieldLabel>
        <input
          id="delete-confirm"
          className={inputCls}
          value={text}
          autoComplete="off"
          autoCapitalize="characters"
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
        />
        {error && (
          <p className="mt-1.5 text-meta text-danger-text" role="alert">
            {error}
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="submit" variant="danger-solid" loading={busy} disabled={!ok}>
            Delete everything
          </Button>
          <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
