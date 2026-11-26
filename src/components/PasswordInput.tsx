"use client";

import { useState } from "react";
import { Eye, EyeOff, Check, X } from "lucide-react";
import { checkPassword } from "@/lib/passwordRule";
import { cx, inputCls } from "./ui";

/** Password field with a Show/Hide eye button (44 px target). */
export function PasswordInput({
  id,
  value,
  onChange,
  placeholder,
  autoComplete,
  required,
  maxLength,
  "aria-describedby": describedBy,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete?: string;
  required?: boolean;
  maxLength?: number;
  "aria-describedby"?: string;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <input
        id={id}
        className={cx(inputCls, "pr-12")}
        type={shown ? "text" : "password"}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required={required}
        maxLength={maxLength}
        aria-describedby={describedBy}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-label={shown ? "Hide password" : "Show password"}
        aria-pressed={shown}
        className="absolute right-0 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-btn text-muted-foreground hover:text-foreground"
      >
        {shown ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
      </button>
    </div>
  );
}

/** Live sign-up rules. Each line has a tick or cross plus words, so colour is never the only cue. */
export function PasswordChecklist({ password, id }: { password: string; id?: string }) {
  return (
    <ul id={id} className="mt-2 space-y-1 text-meta" aria-label="Password rules">
      {checkPassword(password).map((c) => (
        <li key={c.id} className={cx("flex items-center gap-1.5", c.ok ? "text-success-text" : "text-muted-foreground")}>
          {c.ok ? <Check className="h-3.5 w-3.5" aria-hidden /> : <X className="h-3.5 w-3.5" aria-hidden />}
          <span>
            {c.label}
            <span className="sr-only">{c.ok ? " (done)" : " (not yet)"}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
