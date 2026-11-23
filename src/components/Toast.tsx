"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, CloudOff, Info } from "lucide-react";
import { cx } from "./ui";

export type ToastTone = "success" | "warning" | "danger" | "neutral";
type ToastFn = (text: string, tone?: ToastTone) => void;
type Current = { id: number; text: string; tone: ToastTone; leaving: boolean };

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

  const toast = useCallback<ToastFn>((text, tone = "success") => {
    clearTimers();
    const id = ++idRef.current;
    setCurrent({ id, text, tone, leaving: false });
    hideTimer.current = setTimeout(() => {
      setCurrent((c) => (c && c.id === id ? { ...c, leaving: true } : c));
      removeTimer.current = setTimeout(() => {
        setCurrent((c) => (c && c.id === id ? null : c));
      }, 200);
    }, 2500);
  }, []);

  useEffect(() => clearTimers, []);

  const value = useMemo(() => toast, [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 z-50 flex justify-center bottom-[calc(88px+var(--safe-area-inset-bottom,env(safe-area-inset-bottom)))] lg:bottom-6 lg:left-60"
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
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}
