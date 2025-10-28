"use client";

import { useState, useTransition } from "react";

import { sendMessage } from "@/app/pages/conversation/functions";

interface ConversationComposerProps {
  branchId: string;
  conversationId: string;
}

export function ConversationComposer({
  branchId,
  conversationId,
}: ConversationComposerProps) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const content = value.trim();
    if (!content) {
      setError("Enter a message before sending.");
      return;
    }

    setError(null);
    startTransition(async () => {
      try {
        await sendMessage({
          conversationId,
          branchId,
          content,
        });
        setValue("");
      } catch (cause) {
        console.error("[Composer] sendMessage failed", cause);
        setError("We couldn't send that message. Please try again.");
      }
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 shadow-sm"
    >
      <label className="flex flex-col gap-2">
        <span className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          New Message
        </span>
        <textarea
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Ask Connexus to explore a new direction..."
          rows={4}
          className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-70"
          disabled={isPending}
          aria-disabled={isPending}
        />
      </label>

      <div className="flex items-center justify-between gap-3">
        {error ? (
          <p className="text-xs text-destructive" role="status">
            {error}
          </p>
        ) : (
          <span className="text-xs text-muted-foreground">
            Shift+Enter for line break
          </span>
        )}

        <button
          type="submit"
          disabled={isPending}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {isPending ? "Sending…" : "Send"}
        </button>
      </div>
    </form>
  );
}
