import type { AppContext } from "@/app/context";
import {
  ConversationDirectoryClient,
  type ConversationDirectoryEntry,
} from "@/lib/durable-objects/ConversationDirectory";

function getClient(ctx: AppContext): ConversationDirectoryClient {
  return ctx.getConversationDirectory();
}

export async function listConversationDirectoryEntries(
  ctx: AppContext,
): Promise<ConversationDirectoryEntry[]> {
  const client = getClient(ctx);
  return client.list({
    ownerId: ctx.auth.userId,
  });
}

export async function ensureConversationDirectoryEntry(
  ctx: AppContext,
  entry: {
    id: ConversationDirectoryEntry["id"];
    title?: string;
    branchCount?: number;
    lastActiveAt?: string;
    archivedAt?: string | null;
  },
): Promise<ConversationDirectoryEntry> {
  const client = getClient(ctx);
  return client.create({
    ...entry,
    ownerId: ctx.auth.userId,
  });
}

export async function touchConversationDirectoryEntry(
  ctx: AppContext,
  entry: {
    id: ConversationDirectoryEntry["id"];
    title?: string;
    branchCount?: number;
    lastActiveAt?: string;
    archivedAt?: string | null;
  },
): Promise<ConversationDirectoryEntry> {
  const client = getClient(ctx);
  return client.touch({
    ...entry,
    ownerId: ctx.auth.userId,
  });
}

export async function archiveConversationDirectoryEntry(
  ctx: AppContext,
  entry: { id: ConversationDirectoryEntry["id"]; archivedAt?: string },
): Promise<ConversationDirectoryEntry> {
  const client = getClient(ctx);
  return client.archive({
    ...entry,
    ownerId: ctx.auth.userId,
  });
}

export async function unarchiveConversationDirectoryEntry(
  ctx: AppContext,
  entry: { id: ConversationDirectoryEntry["id"] },
): Promise<ConversationDirectoryEntry> {
  const client = getClient(ctx);
  return client.unarchive({
    ...entry,
    ownerId: ctx.auth.userId,
  });
}

export async function deleteConversationDirectoryEntry(
  ctx: AppContext,
  entry: { id: ConversationDirectoryEntry["id"] },
): Promise<void> {
  const client = getClient(ctx);
  await client.delete({
    ...entry,
    ownerId: ctx.auth.userId,
  });
}
