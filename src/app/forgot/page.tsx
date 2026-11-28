"use client";

import { useState } from "react";
import Link from "next/link";
import { AudioLines } from "lucide-react";
import { Button, FieldLabel, Panel, inputCls } from "@/components/ui";
import { isReachable } from "@/lib/connectivity";

const UNREACHABLE = "Couldn't reach the server. Check your connection and try again.";

export default function ForgotPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (!(await isReachable({ force: true }))) return setError(UNREACHABLE);
      const res = await fetch("/api/auth/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setError(data.error || "Something went wrong. Please try again.");
      setSent(data.message || "If an account exists for that email, we've sent a reset link.");
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
        <h1 className="text-2xl font-semibold tracking-tight">Forgot password</h1>
        <p className="mt-1.5 text-ui text-muted-foreground">Enter your email and we will send you a link to set a new one.</p>
        {sent ? (
          <p className="mt-6 rounded-chip bg-muted px-3 py-2 text-ui" role="status">
            {sent}
          </p>
        ) : (
          <form onSubmit={submit} className="mt-6 space-y-4">
            <div>
              <FieldLabel htmlFor="email">Email</FieldLabel>
              <input id="email" className={inputCls} type="email" placeholder="you@example.com" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            {error && (
              <p className="text-meta text-danger-text" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" variant="primary" size="lg" loading={loading} className="w-full">
              Send link
            </Button>
          </form>
        )}
        <p className="mt-6 text-center text-meta text-muted-foreground">
          <Link href="/login" className="underline-offset-2 hover:underline">
            Back to sign in
          </Link>
        </p>
      </Panel>
    </main>
  );
}
