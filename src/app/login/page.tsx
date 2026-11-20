"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Mic, AudioLines, Users, Sparkles } from "lucide-react";

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
    "w-full rounded-2xl border border-border bg-background px-4 py-3 text-base outline-none focus:border-accent";

  return (
    <div className="min-h-dvh grid lg:grid-cols-2">
      {/* Brand panel (laptops) */}
      <aside className="hidden lg:flex flex-col justify-between bg-accent text-accent-foreground p-12 xl:p-16 relative overflow-hidden">
        <div className="absolute -right-24 -top-24 w-96 h-96 rounded-full bg-white/10" aria-hidden />
        <div className="absolute -left-16 bottom-10 w-72 h-72 rounded-full bg-white/5" aria-hidden />
        <div className="relative flex items-center gap-2.5 text-lg font-semibold">
          <span className="w-9 h-9 rounded-xl bg-white/15 grid place-items-center"><AudioLines className="w-5 h-5" /></span>
          Transcriber
        </div>
        <div className="relative max-w-md">
          <h2 className="text-4xl font-bold tracking-tight leading-tight">Every meeting, written up for you.</h2>
          <ul className="mt-8 space-y-4 text-base">
            {[
              [Mic, "Live transcript on your phone or laptop: free and on-device, or in the cloud."],
              [Users, "Cloud mode tells speakers apart, with Hindi and Indian accents."],
              [Sparkles, "One tap for Minutes of Meeting or a Report, then export to PDF or Word."],
            ].map(([Icon, text], i) => {
              const I = Icon as typeof Mic;
              return (
                <li key={i} className="flex gap-3">
                  <span className="w-8 h-8 shrink-0 rounded-lg bg-white/15 grid place-items-center"><I className="w-4 h-4" /></span>
                  <span className="opacity-90 pt-1">{text as string}</span>
                </li>
              );
            })}
          </ul>
        </div>
        <p className="relative text-sm opacity-70">Your recordings sync across all your devices.</p>
      </aside>

      {/* Form */}
      <main className="grid place-items-center p-4 sm:p-8">
        <div className="w-full max-w-sm">
          <div className="flex flex-col items-center lg:items-start mb-8">
            <div className="lg:hidden w-12 h-12 rounded-2xl bg-accent text-accent-foreground grid place-items-center mb-4 shadow-card">
              <AudioLines className="w-6 h-6" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
              {mode === "signin" ? "Welcome back" : "Create your account"}
            </h1>
            <p className="text-sm text-muted-foreground mt-1.5">
              {mode === "signin" ? "Sign in to see your meetings." : "Free to start. Record your first meeting in a minute."}
            </p>
          </div>

          <div className="grid grid-cols-2 p-1 bg-muted rounded-xl mb-5" role="tablist">
            {(["signin", "register"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => { setMode(m); setError(""); }}
                className={`py-2 text-sm font-medium rounded-lg ${mode === m ? "bg-card shadow-card" : "text-muted-foreground"}`}
              >
                {m === "signin" ? "Sign in" : "Create account"}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="space-y-3">
            <label className="block">
              <span className="block text-sm font-medium mb-1.5">Email</span>
              <input className={input} type="email" placeholder="you@example.com" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label className="block">
              <span className="block text-sm font-medium mb-1.5">Password</span>
              <input className={input} type="password" placeholder={mode === "register" ? "At least 6 characters" : "Your password"} autoComplete={mode === "signin" ? "current-password" : "new-password"} required value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            {mode === "register" && (
              <label className="block">
                <span className="block text-sm font-medium mb-1.5">Confirm password</span>
                <input className={input} type="password" placeholder="Type it again" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              </label>
            )}
            {error && <p className="text-sm text-danger" role="alert">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="!mt-5 w-full rounded-2xl bg-accent text-accent-foreground py-3 font-semibold flex items-center justify-center gap-2 shadow-card hover:opacity-95 disabled:opacity-60"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {mode === "signin" ? "Sign in" : "Create account"}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
