import { CalendarX } from "lucide-react";

/** Friendly dead end for public booking pages (server-renderable). */
export function PublicNotice({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-md rounded-panel border border-border/70 bg-card p-6 text-center shadow-card">
      <CalendarX className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden />
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">{title}</h1>
      {children && <p className="mt-1.5 text-ui text-muted-foreground">{children}</p>}
    </div>
  );
}
