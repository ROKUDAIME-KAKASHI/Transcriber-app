"use client";

import { useState } from "react";
import { Button, FieldLabel, Notice, Panel, PanelHeader, inputCls } from "./ui";

export function AdminLogin() {
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pw }),
      });
      if (res.ok) {
        window.location.reload();
        return;
      }
      setErr(res.status === 429 ? "Too many attempts. Try again later." : "Incorrect password.");
    } catch {
      setErr("Could not reach the server.");
    }
    setBusy(false);
  }

  return (
    <Panel className="mx-auto w-full max-w-sm">
      <PanelHeader title="Admin sign in" />
      <form onSubmit={submit} className="space-y-4 p-4">
        <div>
          <FieldLabel htmlFor="admin-pw">Password</FieldLabel>
          <input
            id="admin-pw"
            type="password"
            autoComplete="current-password"
            maxLength={200}
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            className={inputCls}
          />
        </div>
        {err && <Notice tone="danger">{err}</Notice>}
        <Button type="submit" variant="primary" loading={busy} disabled={!pw} className="w-full">
          Sign in
        </Button>
      </form>
    </Panel>
  );
}

export function AdminLogout() {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="secondary"
      loading={busy}
      onClick={async () => {
        setBusy(true);
        await fetch("/api/admin/logout", { method: "POST" }).catch(() => {});
        window.location.reload();
      }}
    >
      Log out
    </Button>
  );
}

export type UserRowView = {
  id: string;
  email: string;
  joined: string;
  meetings: number;
  hours: string;
  cloudHours: string;
  last: string;
};

export function AdminUsersTable({ rows }: { rows: UserRowView[] }) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const shown = needle ? rows.filter((r) => r.email.toLowerCase().includes(needle)) : rows;
  return (
    <Panel>
      <PanelHeader title="Users" meta={`${shown.length} of ${rows.length}`} />
      <div className="border-b border-border/70 p-3">
        <input
          type="search"
          aria-label="Search users by email"
          placeholder="Search email"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className={inputCls}
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-meta">
          <thead className="text-muted-foreground">
            <tr className="border-b border-border/70">
              {["Email", "Joined", "Meetings", "Hours", "Cloud hrs", "Last meeting"].map((h) => (
                <th key={h} className="whitespace-nowrap px-4 py-2 font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {shown.map((r) => (
              <tr key={r.id} className="border-b border-border/40 last:border-0">
                <td className="px-4 py-2">{r.email}</td>
                <td className="whitespace-nowrap px-4 py-2">{r.joined}</td>
                <td className="px-4 py-2">{r.meetings}</td>
                <td className="px-4 py-2">{r.hours}</td>
                <td className="px-4 py-2">{r.cloudHours}</td>
                <td className="whitespace-nowrap px-4 py-2">{r.last}</td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-4 text-muted-foreground">No users match.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
