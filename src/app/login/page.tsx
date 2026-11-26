"use client";

import { signIn } from "next-auth/react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Mic, AudioLines, Users, FileText } from "lucide-react";
import { Button, FieldLabel, Panel, Segmented, inputCls } from "@/components/ui";
import { useAuth } from "@/components/AuthProvider";
import { isReachable, useConnectivity } from "@/lib/connectivity";
import { PasswordChecklist, PasswordInput } from "@/components/PasswordInput";
import { EMAIL_DOMAIN_MESSAGE, isAllowedEmailDomain } from "@/lib/emailRule";
import { passwordProblem } from "@/lib/passwordRule";

const UNREACHABLE = "Couldn't reach the server. Check your connection and try again.";

export default function LoginPage() {
  const [mode, setMode] = useState<"signin" | "register">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [deleted, setDeleted] = useState(false);
  useEffect(() => {
    // /login?deleted=1 is where account deletion lands.
    setDeleted(new URLSearchParams(window.location.search).get("deleted") === "1");
  }, []);
  const router = useRouter();
  const { recheck } = useAuth();
  const online = useConnectivity() === "online";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (mode === "register") {
      if (!isAllowedEmailDomain(email)) return setError(EMAIL_DOMAIN_MESSAGE);
      const weak = passwordProblem(password);
      if (weak) return setError(weak);
      if (password !== confirm) return setError("Passwords do not match.");
    }

    setLoading(true);
    try {
      // signIn() hard-navigates to /api/auth/error when its provider fetch fails, so check first.
      if (!(await isReachable({ force: true }))) return setError(UNREACHABLE);
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
        setError(res.error.includes("No account") || res.error.includes("Incorrect") || res.error === EMAIL_DOMAIN_MESSAGE ? res.error : "Sign in failed.");
        return;
      }
      // AuthProvider lives in the root layout and still holds the pre-sign-in "no session" probe.
      // Refresh it first, otherwise AuthGate on "/" bounces us back here (a refresh used to fix it).
      let state = await recheck();
      if (state !== "ok-user") {
        await new Promise((r) => setTimeout(r, 400));
        state = await recheck();
      }
      if (state !== "ok-user") return setError("Signed in, but the session didn't load. Tap Sign in again.");
      router.push("/");
      router.refresh();
    } catch {
      setError(UNREACHABLE);
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
      <aside className="hidden flex-col justify-between border-r border-border/70 bg-card px-12 py-10 lg:flex xl:px-16">
        <div className="flex items-center gap-2.5 text-ui font-semibold tracking-tight">
          <span className="grid h-7 w-7 place-items-center rounded-[8px] bg-accent text-accent-foreground">
            <AudioLines className="h-4 w-4" />
          </span>
          Minutely
        </div>
        <div className="max-w-md">
          <h2 className="text-2xl font-semibold leading-tight tracking-tight">
            Record the meeting. Get the transcript and the minutes.
          </h2>
          <ul className="mt-10 space-y-6">
            {features.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-4">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-chip bg-accent-soft text-accent-text">
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
        <Panel className="w-full max-w-sm p-6 sm:p-8">
          <div className="mb-8 flex items-center gap-2.5 text-ui font-semibold tracking-tight lg:hidden">
            <span className="grid h-7 w-7 place-items-center rounded-[8px] bg-accent text-accent-foreground">
              <AudioLines className="h-4 w-4" />
            </span>
            Minutely
          </div>
          {deleted && (
            <p className="mb-4 rounded-chip bg-muted px-3 py-2 text-ui" role="status">
              Your account was deleted.
            </p>
          )}
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
              <PasswordInput
                id="password"
                placeholder={mode === "register" ? "At least 8 characters" : "Your password"}
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                required
                value={password}
                onChange={setPassword}
                aria-describedby={mode === "register" ? "pw-rules" : undefined}
              />
              {mode === "register" && <PasswordChecklist id="pw-rules" password={password} />}
            </div>
            {mode === "register" && (
              <div>
                <FieldLabel htmlFor="confirm">Confirm password</FieldLabel>
                <PasswordInput id="confirm" placeholder="Type it again" autoComplete="new-password" required value={confirm} onChange={setConfirm} />
                {confirm && password !== confirm && <p className="mt-1.5 text-meta text-danger-text">Passwords do not match.</p>}
              </div>
            )}
            {error && (
              <p className="text-meta text-danger-text" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" variant="primary" size="lg" loading={loading} disabled={!online} aria-disabled={!online} className="w-full">
              {mode === "signin" ? "Sign in" : "Create account"}
            </Button>
            {!online && (
              <p className="text-meta text-muted-foreground" role="status">
                You're offline. Sign in needs internet.
              </p>
            )}
          </form>
          <p className="mt-6 text-center text-meta text-muted-foreground">
            <Link href="/privacy" className="underline-offset-2 hover:underline">
              Privacy
            </Link>
          </p>
        </Panel>
      </main>
    </div>
  );
}
