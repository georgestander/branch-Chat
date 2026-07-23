import type { BranchId } from "@branchy/conversation-core";

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
