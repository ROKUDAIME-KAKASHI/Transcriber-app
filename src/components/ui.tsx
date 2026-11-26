"use client";

/**
 * Small design-system primitives, so every screen uses the same buttons, panels, labels and
 * controls. Tokens live in globals.css (Aurora Ink).
 */
import { useId } from "react";
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
  const pill = variant === "primary" || variant === "danger-solid";
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx(
        "inline-flex items-center justify-center gap-2 font-semibold whitespace-nowrap",
        "transition-[transform,background-color,color,box-shadow] duration-[var(--dur-1)] ease-[var(--ease-out)] enabled:active:scale-[0.96]",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        pill ? "rounded-full" : "rounded-btn",
        size === "lg" ? "min-h-12 px-5 text-ui" : "min-h-12 lg:min-h-10 px-4 text-ui",
        variant === "primary" && "bg-accent text-accent-foreground hover:bg-accent/90",
        variant === "secondary" && "border border-border/70 bg-card text-foreground shadow-card hover:bg-muted",
        variant === "ghost" && "text-muted-foreground hover:bg-muted hover:text-foreground",
        variant === "danger" && "text-danger-text hover:bg-danger-soft",
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
    <Tag {...rest} className={cx("rounded-panel border border-border/70 dark:border-border bg-card shadow-card", className)}>
      {children}
    </Tag>
  );
}

export function PanelHeader({ title, meta, children }: { title: ReactNode; meta?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/70 px-4 py-3 min-h-14">
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
    <label htmlFor={htmlFor} className="mb-1.5 block text-meta font-semibold text-foreground">
      {children}
    </label>
  );
}

export const inputCls =
  "w-full min-h-12 lg:min-h-11 rounded-chip border border-transparent bg-muted px-4 text-base sm:text-ui outline-none transition-[box-shadow,background-color] duration-[var(--dur-2)] placeholder:text-muted-foreground focus:ring-2 focus:ring-accent disabled:opacity-60";
export const selectCls = cx("select", inputCls);

/* ---------- Segmented control ---------- */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  disabled,
  className,
  semantics = "radio",
}: {
  options: { value: T; label: ReactNode; disabled?: boolean; icon?: ReactNode; id?: string; controls?: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  disabled?: boolean;
  className?: string;
  semantics?: "radio" | "tabs";
}) {
  const n = options.length;
  const index = options.findIndex((o) => o.value === value);
  const tabs = semantics === "tabs";
  return (
    <div
      role={tabs ? "tablist" : "radiogroup"}
      aria-label={label}
      onKeyDown={(e) => {
        const keys = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"];
        if (disabled || !keys.includes(e.key)) return;
        const enabled = options.filter((o) => !o.disabled);
        if (enabled.length === 0) return;
        const cur = enabled.findIndex((o) => o.value === value);
        let next = cur;
        if (e.key === "Home") next = 0;
        else if (e.key === "End") next = enabled.length - 1;
        else if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (cur + 1) % enabled.length;
        else next = (cur - 1 + enabled.length) % enabled.length;
        e.preventDefault();
        const target = enabled[next];
        onChange(target.value);
        const btn = e.currentTarget.querySelectorAll<HTMLButtonElement>("button")[options.indexOf(target)];
        btn?.focus();
      }}
      className={cx("relative grid gap-1 rounded-btn bg-muted p-1", className)}
      style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}
    >
      {index >= 0 && (
        <span
          aria-hidden
          className="pointer-events-none absolute top-1 bottom-1 left-1 rounded-chip bg-card shadow-card"
          style={{
            width: `calc((100% - 0.5rem - ${(n - 1) * 0.25}rem) / ${n})`,
            transform: `translateX(calc(${index} * (100% + 0.25rem)))`,
            transition: "transform var(--dur-4) var(--spring)",
          }}
        />
      )}
      {options.map((o) => {
        const on = o.value === value;
        const off = disabled || o.disabled;
        return (
          <button
            key={o.value}
            type="button"
            id={o.id}
            role={tabs ? "tab" : "radio"}
            aria-checked={tabs ? undefined : on}
            aria-selected={tabs ? on : undefined}
            aria-controls={tabs ? o.controls : undefined}
            tabIndex={on || (index < 0 && o === options[0]) ? 0 : -1}
            aria-disabled={o.disabled || undefined}
            disabled={disabled}
            onClick={() => {
              if (!o.disabled) onChange(o.value);
            }}
            className={cx(
              "relative z-10 inline-flex min-h-10 items-center justify-center gap-1.5 rounded-chip px-3 text-ui",
              "transition-[color,transform] duration-[var(--dur-2)] enabled:active:scale-[0.96]",
              on ? "font-semibold text-foreground" : "font-semibold text-muted-foreground hover:text-foreground",
              o.disabled && "cursor-not-allowed",
              off && "opacity-60"
            )}
          >
            {o.icon}
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
  options: { value: T; title: ReactNode; description?: ReactNode; aside?: ReactNode; icon?: ReactNode; disabled?: boolean }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="overflow-hidden rounded-chip border border-border/70 divide-y divide-border/70">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            aria-disabled={o.disabled || undefined}
            disabled={disabled}
            onClick={() => {
              if (!o.disabled) onChange(o.value);
            }}
            className={cx(
              "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors disabled:opacity-60",
              o.disabled && "cursor-not-allowed opacity-50",
              on ? "bg-accent-soft" : o.disabled ? "bg-card" : "bg-card hover:bg-muted/60"
            )}
          >
            <span
              aria-hidden
              className={cx(
                "mt-[3px] grid h-4 w-4 shrink-0 place-items-center rounded-full border-[1.5px]",
                on ? "border-accent" : "border-muted-foreground/75"
              )}
            >
              {on && <span className="h-2 w-2 rounded-full bg-accent" />}
            </span>
            {o.icon && <span className="mt-px shrink-0 text-muted-foreground">{o.icon}</span>}
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className="text-ui font-semibold">{o.title}</span>
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

/** One-line reason under a disabled control. Renders nothing when there is no reason. */
export function GateReason({ id, reason, icon }: { id?: string; reason: string | null | undefined; icon?: ReactNode }) {
  if (!reason) return null;
  return (
    <p id={id} className="mt-2 flex items-center gap-1.5 text-meta text-muted-foreground">
      {icon}
      {reason}
    </p>
  );
}

/* ---------- Badge / status ---------- */
export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "live" | "success" | "accent" | "warning" | "danger";
  children: ReactNode;
}) {
  return (
    <span
      className={cx(
        "inline-flex h-6 items-center gap-1.5 rounded-full px-2 text-meta font-semibold",
        tone === "neutral" && "bg-muted text-muted-foreground",
        tone === "accent" && "bg-accent-soft text-accent-text",
        tone === "success" && "bg-success-soft text-success-text",
        tone === "warning" && "bg-warning-soft text-warning-text",
        tone === "danger" && "bg-danger-soft text-danger-text",
        tone === "live" && "bg-danger-soft text-record"
      )}
    >
      {children}
    </span>
  );
}

export function LiveDot({ paused = false, solid = false }: { paused?: boolean; solid?: boolean }) {
  if (paused) return <span className="inline-block h-2 w-2 rounded-full bg-muted-foreground" aria-hidden />;
  return (
    <span className="relative flex h-2 w-2" aria-hidden>
      {!solid && (
        <span
          className="absolute inline-flex h-full w-full rounded-full bg-record opacity-60"
          style={{ animation: "live-ring 1.6s var(--ease-out) infinite" }}
        />
      )}
      <span className="relative inline-flex h-2 w-2 rounded-full bg-record" />
    </span>
  );
}

/* ---------- Inline messages ---------- */
export function Notice({
  tone = "neutral",
  title,
  children,
  icon,
}: {
  tone?: "neutral" | "danger" | "success" | "warning" | "accent";
  title?: ReactNode;
  children?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div
      role={tone === "danger" ? "alert" : undefined}
      className={cx(
        "flex gap-3 rounded-chip border px-4 py-3 text-ui",
        tone === "neutral" && "border-border/70 bg-muted/50",
        tone === "danger" && "border-danger/30 bg-danger-soft",
        tone === "success" && "border-success/30 bg-success-soft",
        tone === "warning" && "border-warning/30 bg-warning-soft",
        tone === "accent" && "border-accent/30 bg-accent-soft"
      )}
    >
      {icon && (
        <span
          className={cx(
            "mt-0.5 shrink-0",
            tone === "danger"
              ? "text-danger-text"
              : tone === "success"
                ? "text-success-text"
                : tone === "warning"
                  ? "text-warning-text"
                  : tone === "accent"
                    ? "text-accent-text"
                    : "text-muted-foreground"
          )}
        >
          {icon}
        </span>
      )}
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cx("text-meta text-muted-foreground", title ? "mt-0.5" : "")}>{children}</div>}
      </div>
    </div>
  );
}

/* ---------- Switch row ---------- */
export function Switch({
  checked,
  onChange,
  label,
  description,
  id,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  id?: string;
  disabled?: boolean;
}) {
  const labelId = useId();
  return (
    <div
      onClick={() => {
        if (!disabled) onChange(!checked);
      }}
      className={cx(
        "flex min-h-12 w-full cursor-pointer items-center justify-between gap-3 rounded-chip px-3 py-2 transition-colors hover:bg-muted",
        disabled && "cursor-not-allowed opacity-60"
      )}
    >
      <span className="min-w-0">
        <span id={labelId} className="block text-ui font-semibold">{label}</span>
        {description && <span id={`${labelId}-d`} className="mt-0.5 block text-meta text-muted-foreground">{description}</span>}
      </span>
      <SwitchButton id={id} labelledBy={labelId} describedBy={description ? `${labelId}-d` : undefined} checked={checked} disabled={disabled} onChange={onChange} />
    </div>
  );
}

/** The bare on/off switch (no label row), for rows that lay out their own text. Pass `labelledBy` or `label`. */
export function SwitchButton({
  checked,
  onChange,
  id,
  disabled,
  labelledBy,
  describedBy,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  id?: string;
  disabled?: boolean;
  labelledBy?: string;
  describedBy?: string;
  label?: string;
}) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : label}
      aria-describedby={describedBy}
      aria-checked={checked}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      className={cx(
        "relative h-[26px] w-[44px] shrink-0 rounded-full transition-colors duration-[var(--dur-2)]",
        checked ? "bg-accent" : "bg-muted-foreground/75"
      )}
    >
      <span
        aria-hidden
        className="absolute left-[3px] top-[3px] h-5 w-5 rounded-full bg-white shadow-card"
        style={{
          transform: checked ? "translateX(18px)" : "translateX(0)",
          transition: "transform var(--dur-2) var(--spring)",
        }}
      />
    </button>
  );
}

/** Small tag for settings that only apply to the phone or browser you are using, not your account. */
export function DeviceTag() {
  return (
    <span className="ml-2 inline-flex h-5 items-center rounded-full bg-muted px-2 align-middle text-meta font-medium text-muted-foreground">
      This device
    </span>
  );
}
