"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/lib/themePref";
import { toggleTheme } from "@/lib/theme";
import { cx } from "./ui";

/** Sun/moon button: switches between light and dark. The three-way choice lives in Profile > Preferences. */
export function ThemeToggle({ className }: { className?: string }) {
  const { pref, systemDark, setPref } = useTheme();
  const next = toggleTheme(pref, systemDark);
  return (
    <button
      type="button"
      onClick={() => setPref(next)}
      aria-label={next === "dark" ? "Switch to dark theme" : "Switch to light theme"}
      title={next === "dark" ? "Dark theme" : "Light theme"}
      className={cx("grid h-11 w-11 shrink-0 place-items-center rounded-btn text-muted-foreground hover:bg-muted hover:text-foreground", className)}
    >
      {next === "dark" ? <Moon className="h-5 w-5" aria-hidden /> : <Sun className="h-5 w-5" aria-hidden />}
    </button>
  );
}
