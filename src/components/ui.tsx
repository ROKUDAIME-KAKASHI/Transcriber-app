"use client";

/**
 * Small design-system primitives, so every screen uses the same buttons, panels, labels and
 * controls. Tokens live in globals.css.
 */
import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { Loader2 } from "lucide-react";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

/* ---------- Button ---------- */
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** primary: the one main action per view. secondary: everything else. */
  variant?: "primary" | "secondary" | "ghost" | "danger" | "danger-solid";
  size?: "md" | "lg";
  loading?: boolean;
  icon?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
};

export function Button({ variant = "secondary", size = "md", loading, icon, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-xl font-semibold whitespace-nowrap transition-colors",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        size === "lg" ? "min-h-12 px-5 text-ui" : "min-h-11 lg:min-h-10 px-4 text-ui",
        variant === "primary" && "bg-accent text-accent-foreground hover:bg-accent/90",
        variant === "secondary" && "border border-border bg-card text-foreground hover:bg-muted",
        variant === "ghost" && "text-muted-foreground hover:bg-muted hover:text-foreground",
        variant === "danger" && "text-danger hover:bg-danger/10",
        variant === "danger-solid" && "bg-danger text-white hover:bg-danger/90",
        className
      )}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

/* ---------- Panel ---------- */
export function Panel({
  children,
  className,
  as: Tag = "section",
  ...rest
}: { children: ReactNode; className?: string; as?: "section" | "div" | "aside" } & Record<string, unknown>) {
  return (
    <Tag {...rest} className={cx("rounded-panel border border-border bg-card", className)}>
      {children}
    </Tag>
  );
}

export function PanelHeader({ title, meta, children }: { title: ReactNode; meta?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5 min-h-14">
      <div className="flex min-w-0 items-center gap-2.5">
        <h2 className="truncate text-ui font-semibold">{title}</h2>
        {children}
      </div>
      {meta && <div className="shrink-0 text-meta text-muted-foreground tabular-nums">{meta}</div>}
    </div>
  );
}

/* ---------- Labels & fields ---------- */
export function FieldLabel({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-meta font-medium text-foreground">
      {children}
    </label>
  );
}

export const inputCls =
  "w-full min-h-11 rounded-xl border border-border bg-card px-3.5 text-base sm:text-ui outline-none transition-colors placeholder:text-muted-foreground focus:border-accent disabled:opacity-60";
export const selectCls = cx("select", inputCls);

/* ---------- Segmented control ---------- */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  disabled,
  className,
}: {
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cx("grid gap-1 rounded-xl bg-muted p-1", className)}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={cx(
              "min-h-10 rounded-lg px-3 text-ui font-medium transition-colors disabled:opacity-60",
              on ? "bg-card text-foreground ring-1 ring-border" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ---------- Option list (radio rows with a description) ---------- */
export function OptionList<T extends string>({
  options,
  value,
  onChange,
  label,
  disabled,
}: {
  options: { value: T; title: ReactNode; description?: ReactNode; aside?: ReactNode; icon?: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="overflow-hidden rounded-xl border border-border divide-y divide-border">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={cx(
              "flex w-full items-start gap-3 px-3.5 py-3 text-left transition-colors disabled:opacity-60",
              on ? "bg-accent/[0.06]" : "bg-card hover:bg-muted/60"
            )}
          >
            <span
              aria-hidden
              className={cx(
                "mt-[3px] grid h-4 w-4 shrink-0 place-items-center rounded-full border-[1.5px]",
                on ? "border-accent" : "border-muted-foreground/50"
              )}
            >
              {on && <span className="h-2 w-2 rounded-full bg-accent" />}
            </span>
            {o.icon && <span className="mt-px shrink-0 text-muted-foreground">{o.icon}</span>}
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className="text-ui font-medium">{o.title}</span>
                {o.aside && <span className="shrink-0 text-meta text-muted-foreground">{o.aside}</span>}
              </span>
              {o.description && <span className="mt-0.5 block text-meta text-muted-foreground">{o.description}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ---------- Badge / status ---------- */
export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "live" | "success" | "accent"; children: ReactNode }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-meta font-medium",
        tone === "neutral" && "bg-muted text-muted-foreground",
        tone === "live" && "bg-danger/10 text-danger",
        tone === "success" && "bg-success/10 text-success",
        tone === "accent" && "bg-accent/10 text-accent"
      )}
    >
      {children}
    </span>
  );
}

export function LiveDot({ paused = false }: { paused?: boolean }) {
  if (paused) return <span className="inline-block h-2 w-2 rounded-full bg-muted-foreground" aria-hidden />;
  return (
    <span className="relative flex h-2 w-2" aria-hidden>
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-danger opacity-60" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-danger" />
    </span>
  );
}

/* ---------- Inline messages ---------- */
export function Notice({ tone = "neutral", title, children, icon }: { tone?: "neutral" | "danger" | "success"; title?: ReactNode; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div
      role={tone === "danger" ? "alert" : undefined}
      className={cx(
        "flex gap-3 rounded-xl border px-3.5 py-3 text-ui",
        tone === "neutral" && "border-border bg-muted/50",
        tone === "danger" && "border-danger/30 bg-danger/[0.06]",
        tone === "success" && "border-success/30 bg-success/[0.06]"
      )}
    >
      {icon && <span className={cx("mt-0.5 shrink-0", tone === "danger" ? "text-danger" : tone === "success" ? "text-success" : "text-muted-foreground")}>{icon}</span>}
      <div className="min-w-0">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={cx("text-meta text-muted-foreground", title ? "mt-0.5" : "")}>{children}</div>}
      </div>
    </div>
  );
}
