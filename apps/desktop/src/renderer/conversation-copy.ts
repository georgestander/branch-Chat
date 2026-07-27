import type { Message } from "@branchy/conversation-core";

export type ClipboardWriter = {
  writeText: (text: string) => Promise<void>;
};

export async function copyTextToClipboard(
  text: string,
  clipboard: ClipboardWriter | null | undefined,
): Promise<boolean> {
  if (!text || !clipboard) return false;
  try {
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function formatConversationThread(options: {
  title: string;
  messages: readonly Message[];
  pendingAssistantText?: string | null;
}): string {
  const sections = options.messages.flatMap((message) => {
    const body = formatMessageBody(message);
    return body ? [formatRoleSection(message.role, body)] : [];
  });
  const pendingAssistantText = options.pendingAssistantText?.trim();
  if (pendingAssistantText) {
    sections.push(formatRoleSection("assistant", pendingAssistantText));
  }

  const title = options.title.trim() || "Untitled conversation";
  return [`# ${title}`, ...sections].join("\n\n");
}

function formatMessageBody(message: Message): string {
  const sections: string[] = [];
  const content = message.content.trim();
  if (content) sections.push(content);
  const attachments = (message.attachments ?? []).map(
    (attachment) => `[Attachment: ${attachment.name}]`,
  );
  if (attachments.length > 0) sections.push(attachments.join("\n"));
  return sections.join("\n\n");
}

function formatRoleSection(role: Message["role"], body: string): string {
  const label =
    role === "assistant" ? "Assistant" : role === "user" ? "User" : "System";
  return `## ${label}\n${body}`;
}
