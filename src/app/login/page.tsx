"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mic, AudioLines, Users, FileText } from "lucide-react";
import { Button, FieldLabel, Segmented, inputCls } from "@/components/ui";

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
        const data = await res.json().catch(() => ({}));
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

  const features = [
    { icon: Mic, title: "Record on any device", text: "Phone or laptop. On-device transcription is free and private." },
    { icon: Users, title: "Know who said what", text: "Cloud mode labels each speaker, with Hindi and Indian accents." },
    { icon: FileText, title: "Minutes in one step", text: "Decisions and action items, ready to export to PDF or Word." },
  ];

  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {/* About (laptops) */}
      <aside className="hidden flex-col justify-between border-r border-border bg-card px-12 py-10 lg:flex xl:px-16">
        <div className="flex items-center gap-2.5 text-ui font-semibold tracking-tight">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-foreground text-background">
            <AudioLines className="h-4 w-4" />
          </span>
          Transcriber
        </div>
        <div className="max-w-md">
          <h2 className="text-[2rem] font-semibold leading-tight tracking-tight">
            Record the meeting. Get the transcript and the minutes.
          </h2>
          <ul className="mt-10 space-y-6">
            {features.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-4">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-border">
                  <Icon className="h-4 w-4" />
                </span>
                <span>
                  <span className="block text-ui font-medium">{title}</span>
                  <span className="mt-0.5 block text-meta text-muted-foreground">{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-meta text-muted-foreground">Your meetings sync across all your devices.</p>
      </aside>

      {/* Form */}
      <main className="grid place-items-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5 text-ui font-semibold tracking-tight lg:hidden">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-foreground text-background">
              <AudioLines className="h-4 w-4" />
            </span>
            Transcriber
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{mode === "signin" ? "Sign in" : "Create your account"}</h1>
          <p className="mt-1.5 text-ui text-muted-foreground">
            {mode === "signin" ? "Welcome back. Your meetings are waiting." : "Free to start. Record your first meeting in a minute."}
          </p>

          <Segmented
            className="mt-6"
            label="Account"
            value={mode}
            onChange={(m) => {
              setMode(m);
              setError("");
            }}
            options={[
              { value: "signin", label: "Sign in" },
              { value: "register", label: "Create account" },
            ]}
          />

          <form onSubmit={submit} className="mt-6 space-y-4">
            <div>
              <FieldLabel htmlFor="email">Email</FieldLabel>
              <input id="email" className={inputCls} type="email" placeholder="you@example.com" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <FieldLabel htmlFor="password">Password</FieldLabel>
              <input
                id="password"
                className={inputCls}
                type="password"
                placeholder={mode === "register" ? "At least 6 characters" : "Your password"}
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {mode === "register" && (
              <div>
                <FieldLabel htmlFor="confirm">Confirm password</FieldLabel>
                <input id="confirm" className={inputCls} type="password" placeholder="Type it again" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              </div>
            )}
            {error && (
              <p className="text-meta text-danger" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" variant="primary" size="lg" loading={loading} className="w-full">
              {mode === "signin" ? "Sign in" : "Create account"}
            </Button>
          </form>
        </div>
      </main>
    </div>
  );
}
