"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";

type Toast = { id: string; title?: string; description?: string; variant?: "default" | "warning" | "destructive"; duration?: number };

type ToastContextValue = {
  notify: (toast: Omit<Toast, "id">) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const notify = useCallback((toast: Omit<Toast, "id">) => {
    const id = typeof crypto !== "undefined" && (crypto as any).randomUUID ? (crypto as any).randomUUID() : `t-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const entry: Toast = { id, duration: 3500, ...toast };
    setToasts((cur) => [...cur, entry]);
    const timeout = setTimeout(() => {
      setToasts((cur) => cur.filter((t) => t.id !== id));
    }, entry.duration);
    // Cleanup on unmount
    return () => clearTimeout(timeout);
  }, []);

  const value = useMemo(() => ({ notify }), [notify]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex w-[320px] flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={cn(
              "rounded border px-3 py-2 text-sm shadow-sm",
              t.variant === "destructive" && "border-destructive/60 bg-destructive/10 text-destructive",
              t.variant === "warning" && "border-amber-300 bg-amber-50 text-amber-950",
              (!t.variant || t.variant === "default") && "border-border bg-card text-foreground",
            )}
          >
            {t.title ? <div className="font-semibold">{t.title}</div> : null}
            {t.description ? <div className="mt-0.5 opacity-90">{t.description}</div> : null}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

