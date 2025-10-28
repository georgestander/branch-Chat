import {
  DEFAULT_CONVERSATION_ID,
  ensureConversationSnapshot,
  getBranchMessages,
} from "@/app/shared/conversation.server";
import { ConversationComposer } from "@/app/components/conversation/ConversationComposer";
import type { AppRequestInfo } from "@/worker";
import type { Message } from "@/lib/conversation";

interface ConversationPageProps extends AppRequestInfo {
  conversationId?: string;
}

export async function ConversationPage({
  ctx,
  conversationId = DEFAULT_CONVERSATION_ID,
}: ConversationPageProps) {
  const result = await ensureConversationSnapshot(ctx, conversationId);
  const branchId = result.snapshot.conversation.rootBranchId;
  const branch = result.snapshot.branches[branchId];
  const messages = getBranchMessages(result.snapshot, branchId);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-8 px-6 py-8 md:py-12">
      <header className="flex flex-col gap-2 border-b border-border pb-6">
        <span className="text-sm uppercase tracking-[0.2em] text-muted-foreground">
          Connexus Preview
        </span>
        <h1 className="text-3xl font-semibold">{branch?.title ?? "Branch"}</h1>
        <p className="max-w-2xl text-muted-foreground">
          Branch, compare, and explore alternative responses. Streaming and
          branching controls are in progress—this page currently echoes updates
          persisted to the Durable Object.
        </p>
      </header>

      <section className="flex flex-1 flex-col gap-6">
        <ConversationTimeline messages={messages} />
        <ConversationComposer
          branchId={branchId}
          conversationId={result.conversationId}
        />
      </section>
    </main>
  );
}

function ConversationTimeline({ messages }: { messages: Message[] }) {
  if (messages.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-muted/40 px-4 py-10 text-center text-muted-foreground">
        No messages yet. Start the conversation below.
      </div>
    );
  }

  return (
    <ol className="flex flex-col gap-4">
      {messages.map((message) => (
        <li
          key={message.id}
          className="rounded-lg border border-border bg-card px-4 py-3 shadow-sm"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
              {message.role}
            </span>
            <span className="text-xs text-muted-foreground">
              {new Date(message.createdAt).toLocaleString()}
            </span>
          </div>
          <div className="prose prose-sm mt-3 max-w-none whitespace-pre-wrap text-foreground">
            {message.content}
          </div>
        </li>
      ))}
    </ol>
  );
}
