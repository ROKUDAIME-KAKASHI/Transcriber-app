"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Mic } from "lucide-react";

export default function LoginPage() {
  const [mode, setMode] = useState<"signin" | "register">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (mode === "register") {
      if (password.length < 6) return setError("Password must be at least 6 characters long.");
      if (password !== confirm) return setError("Passwords do not match.");
    }

    setLoading(true);
    try {
      if (mode === "register") {
        const res = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        const data = await res.json();
        if (!res.ok) return setError(data.error || "Failed to create account.");
      }

      const res = await signIn("credentials", { email, password, redirect: false });
      if (res?.error) {
        setError(res.error.includes("No account") || res.error.includes("Incorrect") ? res.error : "Sign in failed.");
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setError("Something went wrong. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  const input =
    "w-full rounded-xl border border-border bg-background px-4 py-3 text-base outline-none focus:border-accent";

  return (
    <div className="min-h-dvh grid place-items-center p-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="flex flex-col items-center mb-6">
          <div className="w-12 h-12 rounded-xl bg-accent text-accent-foreground grid place-items-center mb-3">
            <Mic className="w-6 h-6" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Transcriber</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {mode === "signin" ? "Sign in to your meetings" : "Create your account"}
          </p>
        </div>

        <div className="grid grid-cols-2 p-1 bg-muted rounded-xl mb-5">
          {(["signin", "register"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => { setMode(m); setError(""); }}
              className={`py-2 text-sm font-medium rounded-lg ${mode === m ? "bg-card shadow-sm" : "text-muted-foreground"}`}
            >
              {m === "signin" ? "Sign in" : "Create account"}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="space-y-3">
          <input className={input} type="email" placeholder="Email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <input className={input} type="password" placeholder="Password" autoComplete={mode === "signin" ? "current-password" : "new-password"} required value={password} onChange={(e) => setPassword(e.target.value)} />
          {mode === "register" && (
            <input className={input} type="password" placeholder="Confirm password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          )}
          {error && <p className="text-sm text-danger">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-accent text-accent-foreground py-3 font-semibold flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>
      </div>
    </div>
  );
}
