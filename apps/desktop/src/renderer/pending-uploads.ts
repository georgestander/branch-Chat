import type { BranchId } from "@branchy/conversation-core";

import type { AttachmentDraft } from "./types.ts";

type PendingUpload = {
  conversationId: string;
  branchId: BranchId;
  discarded: boolean;
};

export class PendingUploadRegistry {
  readonly #uploads = new Map<string, PendingUpload>();

  begin(localId: string, conversationId: string, branchId: BranchId): void {
    this.#uploads.set(localId, {
      conversationId,
      branchId,
      discarded: false,
    });
  }

  discard(localId: string): void {
    const upload = this.#uploads.get(localId);
    if (upload) upload.discarded = true;
  }

  reconcile(
    conversationId: string | null,
    validBranchIds: ReadonlySet<BranchId>,
  ): void {
    for (const upload of this.#uploads.values()) {
      if (
        upload.conversationId !== conversationId ||
        !validBranchIds.has(upload.branchId)
      ) {
        upload.discarded = true;
      }
    }
  }

  settle(localId: string): PendingUpload | null {
    const upload = this.#uploads.get(localId) ?? null;
    this.#uploads.delete(localId);
    return upload;
  }
}

export function visitDiscardedAttachments(
  attachmentsByBranch: Record<BranchId, AttachmentDraft[] | undefined>,
  validBranchIds: ReadonlySet<BranchId>,
  visitor: {
    upload(localId: string): void;
    ready(attachmentId: string): void;
  },
): void {
  for (const [branchId, attachments] of Object.entries(attachmentsByBranch)) {
    if (validBranchIds.has(branchId)) continue;
    for (const attachment of attachments ?? []) {
      if (attachment.id.startsWith("upload-")) {
        visitor.upload(attachment.id);
      } else if (attachment.status === "ready") {
        visitor.ready(attachment.id);
      }
    }
  }
}
