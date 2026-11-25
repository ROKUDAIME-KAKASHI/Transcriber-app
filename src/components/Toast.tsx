"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, CloudOff, Info } from "lucide-react";
import { cx } from "./ui";

export type ToastTone = "success" | "warning" | "danger" | "neutral";
/** An optional link shown at the end of the toast (it then stays a little longer). */
export type ToastAction = { label: string; href: string };
type ToastFn = (text: string, tone?: ToastTone, action?: ToastAction) => void;
type Current = { id: number; text: string; tone: ToastTone; leaving: boolean; action?: ToastAction };

const ToastContext = createContext<ToastFn | null>(null);

const noop: ToastFn = () => {};

/** Returns toast(text, tone?). A no-op outside the provider. */
export function useToast(): ToastFn {
  return useContext(ToastContext) ?? noop;
}

const ICONS = {
  success: <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />,
  warning: <CloudOff className="h-4 w-4 text-warning" aria-hidden />,
  danger: <AlertCircle className="h-4 w-4 text-danger" aria-hidden />,
  neutral: <Info className="h-4 w-4 text-muted-foreground" aria-hidden />,
} as const;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<Current | null>(null);
  const idRef = useRef(0);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const removeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (removeTimer.current) clearTimeout(removeTimer.current);
    hideTimer.current = null;
    removeTimer.current = null;
  };

  const toast = useCallback<ToastFn>((text, tone = "success", action) => {
    clearTimers();
    const id = ++idRef.current;
    setCurrent({ id, text, tone, leaving: false, action });
    hideTimer.current = setTimeout(() => {
      setCurrent((c) => (c && c.id === id ? { ...c, leaving: true } : c));
      removeTimer.current = setTimeout(() => {
        setCurrent((c) => (c && c.id === id ? null : c));
      }, 200);
    }, action ? 6000 : 2500);
  }, []);

  useEffect(() => clearTimers, []);

  const value = useMemo(() => toast, [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 z-50 flex justify-center bottom-[calc(88px+var(--safe-area-inset-bottom,env(safe-area-inset-bottom)))] [html[data-float-bar]_&]:bottom-[calc(144px+var(--safe-area-inset-bottom,env(safe-area-inset-bottom)))] lg:bottom-6 lg:left-60 lg:[html[data-float-bar]_&]:bottom-6"
      >
        {current && (
          <div
            key={current.id}
            className={cx(
              "glass pointer-events-auto inline-flex h-11 items-center gap-2 rounded-full px-4 text-ui font-semibold shadow-float",
              "transition-[opacity,transform] duration-200",
              current.leaving ? "translate-y-2 opacity-0" : "opacity-100"
            )}
            style={current.leaving ? undefined : { animation: "toast-in var(--dur-4) var(--spring) both" }}
          >
            {ICONS[current.tone]}
            <span>{current.text}</span>
            {current.action && <span aria-hidden className="text-muted-foreground">·</span>}
            {current.action && (
              <Link
                href={current.action.href}
                onClick={() => setCurrent(null)}
                className="-mr-2 inline-flex min-h-9 items-center rounded-full px-2 text-accent underline-offset-2 hover:underline"
              >
                {current.action.label}
              </Link>
            )}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}
