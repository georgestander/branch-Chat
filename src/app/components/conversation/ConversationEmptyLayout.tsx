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

  const handleStartConversation = () => {
    if (isCreating) {
      return;
    }
    setCreationError(null);
    startTransition(async () => {
      try {
        const result: CreateConversationResponse = await createConversation();
        navigate(`/?conversationId=${encodeURIComponent(result.conversationId)}`);
      } catch (error) {
        console.error("[EmptyLayout] createConversation failed", error);
        setCreationError("Unable to start a new chat. Please try again.");
      }
    });
  };

  return (
    <div className="flex h-screen min-h-screen w-full overflow-hidden bg-background text-foreground">
      <aside className="flex w-72 flex-col justify-between border-r border-border bg-muted/20 p-6">
        <div className="space-y-6">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold tracking-tight">Connexus</h2>
            <button
              type="button"
              onClick={handleStartConversation}
              disabled={isCreating}
              className={cn(
                "inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card text-foreground shadow-sm transition hover:bg-muted",
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
                <li key={entry.id} className="truncate opacity-80">
                  {entry.title || entry.id}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </aside>

      <main className="flex flex-1 items-center justify-center px-6">
        <div className="max-w-xl text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Start your first Connexus chat</h1>
          <p className="mt-4 text-sm text-muted-foreground">
            Branch your ideas, compare approaches, and keep every exploration organized. Create a
            new chat to begin.
          </p>
          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <button
              type="button"
              onClick={handleStartConversation}
              disabled={isCreating}
              className={cn(
                "inline-flex items-center gap-2 rounded-full bg-primary px-6 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90",
                isCreating ? "cursor-not-allowed opacity-70" : "",
              )}
            >
              {isCreating ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <SquarePen className="h-4 w-4" aria-hidden="true" />
              )}
              <span>{isCreating ? "Creating…" : "New chat"}</span>
            </button>
            <p className="text-xs text-muted-foreground">
              Create chats only when you need them. Nothing happens until you click “New chat”.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}

