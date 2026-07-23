import type { ConversationGraphSnapshot } from "@branchy/conversation-core";

export const BRANCHY_CHAT_ARCHIVE_FORMAT = "branchychat" as const;
export const BRANCHY_CHAT_ARCHIVE_VERSION = 1 as const;
export const BRANCHY_CHAT_ARCHIVE_MANIFEST_PATH = "manifest.json" as const;

export interface BranchyArchiveLimits {
  maxArchiveBytes: number;
  maxEntries: number;
  maxConversations: number;
  maxEntryBytes: number;
  maxTotalUncompressedBytes: number;
  maxCompressionRatio: number;
  maxPathDepth: number;
  maxManifestBytes: number;
}

export const DEFAULT_BRANCHY_ARCHIVE_LIMITS: Readonly<BranchyArchiveLimits> =
  Object.freeze({
    /*
     * Imports are intentionally staged in the Electron main process so the
     * persistence adapter never sees partially validated data. Keep this
     * envelope conservative until the public staging contract supports
     * temp-file-backed assets.
     */
    maxArchiveBytes: 72 * 1024 * 1024,
    maxEntries: 513,
    maxConversations: 256,
    maxEntryBytes: 32 * 1024 * 1024,
    maxTotalUncompressedBytes: 64 * 1024 * 1024,
    maxCompressionRatio: 250,
    maxPathDepth: 3,
    maxManifestBytes: 8 * 1024 * 1024,
  });

export interface BranchyArchiveAssetInput {
  storageKey: string;
  bytes: Uint8Array;
  contentType?: string | null;
}

export interface BranchyArchiveExportInput {
  snapshots: readonly ConversationGraphSnapshot[];
  assets: readonly BranchyArchiveAssetInput[];
}

export interface BranchyArchiveManifestConversation {
  conversationId: string;
  snapshot: ConversationGraphSnapshot;
  snapshotSha256: string;
}

export interface BranchyArchiveManifestAsset {
  storageKey: string;
  path: string;
  byteLength: number;
  sha256: string;
  contentType: string | null;
}

export interface BranchyArchiveManifestV1 {
  format: typeof BRANCHY_CHAT_ARCHIVE_FORMAT;
  version: typeof BRANCHY_CHAT_ARCHIVE_VERSION;
  conversations: BranchyArchiveManifestConversation[];
  assets: BranchyArchiveManifestAsset[];
}

export interface StagedBranchyArchiveAsset {
  readonly storageKey: string;
  readonly byteLength: number;
  readonly sha256: string;
  readonly contentType: string | null;
  /**
   * An archive-owned validated buffer. Adapters must treat it as read-only.
   */
  readonly bytes: Uint8Array;
}

/**
 * A fully validated, in-memory import unit. Persistence implementations should
 * apply the snapshot and assets in one transaction or transaction-like commit.
 */
export interface StagedBranchyArchive {
  readonly format: typeof BRANCHY_CHAT_ARCHIVE_FORMAT;
  readonly version: typeof BRANCHY_CHAT_ARCHIVE_VERSION;
  readonly snapshots: readonly ConversationGraphSnapshot[];
  readonly assets: readonly StagedBranchyArchiveAsset[];
}

export interface BranchyArchiveImportAdapter<TResult = void> {
  commitArchive(staged: StagedBranchyArchive): Promise<TResult> | TResult;
}

export type BranchyArchiveErrorCode =
  | "archive_too_large"
  | "checksum_mismatch"
  | "compression_ratio_exceeded"
  | "duplicate_entry_path"
  | "duplicate_conversation_id"
  | "duplicate_message_reference"
  | "duplicate_storage_key"
  | "entry_too_large"
  | "empty_conversation_set"
  | "graph_cycle"
  | "graph_orphan"
  | "invalid_archive_limits"
  | "invalid_asset"
  | "invalid_manifest"
  | "invalid_snapshot"
  | "invalid_zip"
  | "manifest_too_large"
  | "missing_archive_entry"
  | "missing_asset"
  | "too_many_entries"
  | "too_many_conversations"
  | "total_size_exceeded"
  | "unexpected_archive_entry"
  | "unexpected_asset"
  | "unsafe_entry_path"
  | "unsafe_storage_key"
  | "unsupported_entry_type"
  | "unsupported_zip_feature";

export class BranchyArchiveError extends Error {
  readonly code: BranchyArchiveErrorCode;

  constructor(
    code: BranchyArchiveErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "BranchyArchiveError";
    this.code = code;
  }
}
