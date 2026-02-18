"use client";

import { useEffect, useMemo, useState } from "react";
import { Laptop, Moon, Sun } from "lucide-react";

import {
  applyThemePreference,
  getInitialThemePreference,
  type ThemePreference,
} from "@/app/components/ui/theme";
import { cn } from "@/lib/utils";

interface ThemeToggleProps {
  className?: string;
  compact?: boolean;
}

const ORDER: ThemePreference[] = ["system", "dark", "light"];

function getNextPreference(current: ThemePreference): ThemePreference {
  const index = ORDER.indexOf(current);
  if (index < 0) {
    return "dark";
  }
  return ORDER[(index + 1) % ORDER.length] ?? "system";
}

export function ThemeToggle({ className, compact = false }: ThemeToggleProps) {
  const [preference, setPreference] = useState<ThemePreference>("system");

  useEffect(() => {
    setPreference(getInitialThemePreference());

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      if (document.documentElement.dataset.themePreference === "system") {
        applyThemePreference("system");
      }
    };
    media.addEventListener("change", handleChange);
    return () => {
      media.removeEventListener("change", handleChange);
    };
  }, []);

  const label = useMemo(() => {
    if (preference === "dark") return "Dark";
    if (preference === "light") return "Light";
    return "System";
  }, [preference]);

  const Icon = preference === "dark" ? Moon : preference === "light" ? Sun : Laptop;

  return (
    <button
      type="button"
      onClick={() => {
        const next = getNextPreference(preference);
        setPreference(next);
        applyThemePreference(next);
      }}
      className={cn(
        "inline-flex items-center gap-1.5 rounded border border-border bg-background px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground transition hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        compact ? "h-9 w-9 justify-center p-0" : "",
        className,
      )}
      aria-label={`Theme: ${label}. Click to cycle theme mode.`}
      title={`Theme: ${label}`}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {compact ? null : <span>{label}</span>}
    </button>
  );
}
