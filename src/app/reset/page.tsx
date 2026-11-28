"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AudioLines } from "lucide-react";
import { Button, FieldLabel, Panel } from "@/components/ui";
import { PasswordChecklist, PasswordInput } from "@/components/PasswordInput";
import { isReachable } from "@/lib/connectivity";
import { passwordProblem } from "@/lib/passwordRule";

const EXPIRED = "This link has expired or was already used. Ask for a new one.";
const UNREACHABLE = "Couldn't reach the server. Check your connection and try again.";

export default function ResetPage() {
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get("token") ?? "");
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const weak = passwordProblem(password);
    if (weak) return setError(weak);
    if (password !== confirm) return setError("Passwords do not match.");
    setLoading(true);
    try {
      if (!(await isReachable({ force: true }))) return setError(UNREACHABLE);
      const res = await fetch("/api/auth/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setError(data.error || "Something went wrong. Please try again.");
      setDone(true);
    } catch {
      setError(UNREACHABLE);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10 sm:px-8">
      <Panel className="w-full max-w-sm p-6 sm:p-8">
        <div className="mb-8 flex items-center gap-2.5 text-ui font-semibold tracking-tight">
          <span className="grid h-7 w-7 place-items-center rounded-[8px] bg-accent text-accent-foreground">
            <AudioLines className="h-4 w-4" />
          </span>
          Minutely
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Set a new password</h1>
        {done ? (
          <p className="mt-4 rounded-chip bg-muted px-3 py-2 text-ui" role="status">
            Password updated. Sign in with your new password.
          </p>
        ) : !token ? (
          <p className="mt-4 text-ui text-danger-text" role="alert">
            {EXPIRED}
          </p>
        ) : (
          <form onSubmit={submit} className="mt-6 space-y-4">
            <div>
              <FieldLabel htmlFor="password">New password</FieldLabel>
              <PasswordInput id="password" placeholder="At least 8 characters" autoComplete="new-password" required value={password} onChange={setPassword} aria-describedby="pw-rules" />
              <PasswordChecklist id="pw-rules" password={password} />
            </div>
            <div>
              <FieldLabel htmlFor="confirm">Confirm password</FieldLabel>
              <PasswordInput id="confirm" placeholder="Type it again" autoComplete="new-password" required value={confirm} onChange={setConfirm} />
              {confirm && password !== confirm && <p className="mt-1.5 text-meta text-danger-text">Passwords do not match.</p>}
            </div>
            {error && (
              <p className="text-meta text-danger-text" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" variant="primary" size="lg" loading={loading} className="w-full">
              Update password
            </Button>
          </form>
        )}
        <p className="mt-6 text-center text-meta text-muted-foreground">
          <Link href="/login" className="underline-offset-2 hover:underline">
            {done ? "Go to sign in" : "Back to sign in"}
          </Link>
        </p>
      </Panel>
    </main>
  );
}
