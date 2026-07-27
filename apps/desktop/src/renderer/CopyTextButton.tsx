import { Check, Copy } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { copyTextToClipboard } from "./conversation-copy.ts";

type CopyTextButtonProps = {
  text: string;
  label: string;
  className?: string;
};

type CopyState = "ready" | "copied" | "error";

export function CopyTextButton({
  text,
  label,
  className,
}: CopyTextButtonProps): React.JSX.Element {
  const [state, setState] = useState<CopyState>("ready");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearResetTimer = useCallback(() => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = null;
  }, []);

  useEffect(() => {
    setState("ready");
    clearResetTimer();
  }, [clearResetTimer, text]);

  useEffect(() => clearResetTimer, [clearResetTimer]);

  const copy = useCallback(async () => {
    clearResetTimer();
    const copied = await copyTextToClipboard(text, navigator.clipboard);
    setState(copied ? "copied" : "error");
    resetTimer.current = setTimeout(() => {
      resetTimer.current = null;
      setState("ready");
    }, 2_000);
  }, [clearResetTimer, text]);

  const disabled = text.trim().length === 0;
  const visibleLabel =
    state === "copied" ? "Copied" : state === "error" ? "Retry" : "Copy";
  const accessibleLabel =
    state === "copied"
      ? `${label} copied`
      : state === "error"
        ? `${label} failed. Retry`
        : label;

  return (
    <button
      className={["message-copy-button", className].filter(Boolean).join(" ")}
      type="button"
      disabled={disabled}
      aria-label={accessibleLabel}
      title={disabled ? "No text to copy" : label}
      data-copy-state={state}
      onClick={() => void copy()}
      onMouseUp={(event) => event.stopPropagation()}
    >
      {state === "copied" ? (
        <Check aria-hidden="true" size={13} strokeWidth={1.8} />
      ) : (
        <Copy aria-hidden="true" size={13} strokeWidth={1.8} />
      )}
      <span aria-live="polite" aria-atomic="true">
        {visibleLabel}
      </span>
    </button>
  );
}
