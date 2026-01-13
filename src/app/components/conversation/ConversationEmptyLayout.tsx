"use client";

import { useState, useTransition } from "react";
import { Loader2, SquarePen } from "lucide-react";
import { navigate } from "rwsdk/client";

import {
  createConversation,
  type CreateConversationResponse,
} from "@/app/pages/conversation/functions";
import type { ConversationDirectoryEntry } from "@/lib/durable-objects/ConversationDirectory";
import { cn } from "@/lib/utils";

interface ConversationEmptyLayoutProps {
  conversations: ConversationDirectoryEntry[];
  missingConversationId?: string | null;
}

export function ConversationEmptyLayout({
  conversations,
  missingConversationId = null,
}: ConversationEmptyLayoutProps) {
  const [creationError, setCreationError] = useState<string | null>(null);
  const [isCreating, startTransition] = useTransition();
  const [draft, setDraft] = useState("");

  const handleStartConversation = (initialMessage?: string) => {
    if (isCreating) {
      return;
    }
    setCreationError(null);
    startTransition(async () => {
      try {
        const trimmedMessage = initialMessage?.trim() ?? "";
        const result: CreateConversationResponse = await createConversation();
        if (trimmedMessage && typeof window !== "undefined") {
          try {
            const storageKey = `connexus:bootstrap:${result.conversationId}`;
            window.sessionStorage.setItem(storageKey, trimmedMessage);
          } catch (storageError) {
            console.warn("[EmptyLayout] unable to persist draft message", storageError);
          }
        }
        navigate(`/?conversationId=${encodeURIComponent(result.conversationId)}`);
      } catch (error) {
        console.error("[EmptyLayout] createConversation failed", error);
        setCreationError("Unable to start a new chat. Please try again.");
      }
    });
  };

  const handleDraftSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    handleStartConversation(draft);
  };

  return (
    <div className="app-shell flex h-screen min-h-screen w-full overflow-hidden text-foreground">
      <aside className="panel-surface panel-edge flex w-72 flex-col justify-between border-r border-foreground/15 bg-background/70 p-6 backdrop-blur">
        <div className="space-y-6">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-semibold tracking-tight">Branch-Chat</h2>
            <button
              type="button"
              onClick={() => handleStartConversation()}
              disabled={isCreating}
              className={cn(
                "inline-flex h-9 w-9 items-center justify-center rounded-md border border-foreground/20 bg-background/70 text-foreground shadow-sm transition hover:bg-background",
                isCreating ? "cursor-not-allowed opacity-70" : "",
              )}
              aria-label={isCreating ? "Creating new chat" : "Start a new chat"}
            >
              {isCreating ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <SquarePen className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">
              {conversations.length === 0
                ? "No conversations yet. Start your first chat to begin exploring branches."
                : "Select an existing chat or start a new one to continue."}
            </p>
            {creationError ? (
              <p className="mt-2 text-xs text-destructive" role="status">
                {creationError}
              </p>
            ) : null}
            {missingConversationId ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Conversation "{missingConversationId}" was not found.
              </p>
            ) : null}
          </div>
        </div>

        {conversations.length > 0 ? (
          <div className="mt-6 space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Recent Chats
            </h3>
            <ul className="space-y-1 text-sm text-muted-foreground">
              {conversations.slice(0, 6).map((entry) => (
                <li key={entry.id}>
                  <a
                    href={`/?conversationId=${encodeURIComponent(entry.id)}`}
                    className="block truncate rounded-md px-2 py-1 transition hover:bg-background hover:text-foreground"
                  >
                    {entry.title || entry.id}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </aside>

      <main className="flex flex-1 items-center justify-center px-6">
        <div className="flex w-full max-w-2xl flex-col items-center gap-6 text-center">
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold tracking-tight">Start your first chat</h1>
            <p className="text-sm text-muted-foreground">
              Branch your ideas, compare approaches, and keep every exploration organized.
            </p>
          </div>
          <form
            onSubmit={handleDraftSubmit}
            className="panel-surface panel-edge w-full rounded-[28px] px-4 py-3"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-full border border-foreground/20 bg-background text-foreground">
                <SquarePen className="h-5 w-5" aria-hidden="true" />
              </div>
              <label className="sr-only" htmlFor="empty-composer">
                Start a new chat
              </label>
              <input
                id="empty-composer"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Ask to explore a new direction…"
                className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                disabled={isCreating}
              />
              <button
                type="submit"
                disabled={isCreating}
                className={cn(
                  "inline-flex h-10 items-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-lg transition hover:bg-primary/90",
                  isCreating ? "cursor-not-allowed opacity-70" : "",
                )}
              >
                {isCreating ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : null}
                <span>{isCreating ? "Creating…" : "Start chat"}</span>
              </button>
            </div>
          </form>
          <p className="text-xs text-muted-foreground">
            We'll start a new chat and send your first message right away.
          </p>
        </div>
      </main>
    </div>
  );
}
