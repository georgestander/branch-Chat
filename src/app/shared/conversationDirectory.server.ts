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
  return client.list();
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
  return client.create(entry);
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
  return client.touch(entry);
}

export async function archiveConversationDirectoryEntry(
  ctx: AppContext,
  entry: { id: ConversationDirectoryEntry["id"]; archivedAt?: string },
): Promise<ConversationDirectoryEntry> {
  const client = getClient(ctx);
  return client.archive(entry);
}

export async function unarchiveConversationDirectoryEntry(
  ctx: AppContext,
  entry: { id: ConversationDirectoryEntry["id"] },
): Promise<ConversationDirectoryEntry> {
  const client = getClient(ctx);
  return client.unarchive(entry);
}

export async function deleteConversationDirectoryEntry(
  ctx: AppContext,
  entry: { id: ConversationDirectoryEntry["id"] },
): Promise<void> {
  const client = getClient(ctx);
  await client.delete(entry);
}
