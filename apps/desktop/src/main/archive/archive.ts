import { createHash } from "node:crypto";

import {
  validateConversationGraphSnapshot,
  type ConversationGraphSnapshot,
} from "@branchy/conversation-core";

import {
  BRANCHY_CHAT_ARCHIVE_FORMAT,
  BRANCHY_CHAT_ARCHIVE_MANIFEST_PATH,
  BRANCHY_CHAT_ARCHIVE_VERSION,
  BranchyArchiveError,
  type BranchyArchiveAssetInput,
  type BranchyArchiveExportInput,
  type BranchyArchiveImportAdapter,
  type BranchyArchiveLimits,
  type BranchyArchiveManifestAsset,
  type BranchyArchiveManifestConversation,
  type BranchyArchiveManifestV1,
  type StagedBranchyArchive,
  type StagedBranchyArchiveAsset,
} from "./types.ts";
import {
  createDeterministicZip,
  extractValidatedZip,
  resolveArchiveLimits,
} from "./zip.ts";

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const MANIFEST_KEYS = new Set([
  "format",
  "version",
  "conversations",
  "assets",
]);
const MANIFEST_CONVERSATION_KEYS = new Set([
  "conversationId",
  "snapshot",
  "snapshotSha256",
]);
const MANIFEST_ASSET_KEYS = new Set([
  "storageKey",
  "path",
  "byteLength",
  "sha256",
  "contentType",
]);

interface AssetReference {
  storageKey: string;
  byteLength: number | null;
  contentType: string | null;
}

function fail(
  code: ConstructorParameters<typeof BranchyArchiveError>[0],
  message: string,
  cause?: unknown,
): never {
  throw new BranchyArchiveError(
    code,
    message,
    cause === undefined ? undefined : { cause },
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertExactKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  label: string,
): void {
  const keys = Object.keys(value);
  if (keys.length !== allowed.size || keys.some((key) => !allowed.has(key))) {
    fail("invalid_manifest", `${label} contains unknown or missing fields`);
  }
}

function canonicalJson(value: unknown): string {
  const ancestors = new Set<object>();

  const encode = (current: unknown, inArray: boolean): string | undefined => {
    if (current === null) {
      return "null";
    }
    if (typeof current === "string" || typeof current === "boolean") {
      return JSON.stringify(current);
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current)) {
        fail("invalid_snapshot", "Snapshot contains a non-finite number");
      }
      return JSON.stringify(current);
    }
    if (current === undefined) {
      if (inArray) {
        fail("invalid_snapshot", "Snapshot arrays may not contain undefined");
      }
      return undefined;
    }
    if (
      typeof current === "bigint" ||
      typeof current === "function" ||
      typeof current === "symbol"
    ) {
      fail("invalid_snapshot", "Snapshot contains a non-JSON value");
    }
    if (typeof current !== "object") {
      fail("invalid_snapshot", "Snapshot contains an unsupported value");
    }
    if (ancestors.has(current)) {
      fail("invalid_snapshot", "Snapshot contains a circular JSON value");
    }

    ancestors.add(current);
    try {
      if (Array.isArray(current)) {
        const items = current.map((item) => {
          const encoded = encode(item, true);
          if (encoded === undefined) {
            fail("invalid_snapshot", "Snapshot array value is not JSON");
          }
          return encoded;
        });
        return `[${items.join(",")}]`;
      }
      if (!isPlainRecord(current)) {
        fail("invalid_snapshot", "Snapshot contains a non-plain object");
      }
      const pairs: string[] = [];
      for (const key of Object.keys(current).sort()) {
        const encoded = encode(current[key], false);
        if (encoded !== undefined) {
          pairs.push(`${JSON.stringify(key)}:${encoded}`);
        }
      }
      return `{${pairs.join(",")}}`;
    } finally {
      ancestors.delete(current);
    }
  };

  const encoded = encode(value, false);
  if (encoded === undefined) {
    fail("invalid_snapshot", "Snapshot is not JSON serializable");
  }
  return encoded;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function encodeUtf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function decodeUtf8(bytes: Uint8Array, label: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    fail("invalid_manifest", `${label} is not valid UTF-8`, error);
  }
}

function validateContentType(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 255 ||
    value !== value.trim() ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    fail("invalid_asset", "Archive asset content type is invalid");
  }
  return value;
}

function validateStorageKey(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 512 ||
    value !== value.trim() ||
    value !== value.normalize("NFC") ||
    value.startsWith("/") ||
    /^[a-zA-Z]:/u.test(value) ||
    value.includes("\\") ||
    value.includes("%") ||
    value.includes("?") ||
    value.includes("#") ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    fail("unsafe_storage_key", "Archive contains an unsafe asset storage key");
  }
  const segments = value.split("/");
  if (
    segments.length > 32 ||
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === "." ||
        segment === ".." ||
        segment.length > 255,
    )
  ) {
    fail("unsafe_storage_key", "Archive asset storage key is not safely bounded");
  }
  return value;
}

function assetPath(sha: string): string {
  return `assets/${sha}.blob`;
}

function mergeReference(
  references: Map<string, AssetReference>,
  next: AssetReference,
): void {
  const current = references.get(next.storageKey);
  if (!current) {
    references.set(next.storageKey, next);
    return;
  }
  if (
    (current.byteLength !== null &&
      next.byteLength !== null &&
      current.byteLength !== next.byteLength) ||
    (current.contentType !== null &&
      next.contentType !== null &&
      current.contentType !== next.contentType)
  ) {
    fail(
      "invalid_snapshot",
      "Snapshot references one storage key with conflicting asset metadata",
    );
  }
  references.set(next.storageKey, {
    storageKey: next.storageKey,
    byteLength: current.byteLength ?? next.byteLength,
    contentType: current.contentType ?? next.contentType,
  });
}

function collectAssetReferences(
  snapshots: readonly ConversationGraphSnapshot[],
): Map<string, AssetReference> {
  const references = new Map<string, AssetReference>();
  for (const snapshot of snapshots) {
    for (const message of Object.values(snapshot.messages)) {
      for (const attachment of message.attachments ?? []) {
        const storageKey = validateStorageKey(attachment.storageKey);
        mergeReference(references, {
          storageKey,
          byteLength: attachment.size,
          contentType: attachment.contentType,
        });
      }

      for (const invocation of message.toolInvocations ?? []) {
        if (
          invocation.toolType !== "image_generation" ||
          !isPlainRecord(invocation.output) ||
          !Object.hasOwn(invocation.output, "storageKey")
        ) {
          continue;
        }
        const storageKey = validateStorageKey(invocation.output.storageKey);
        const contentType =
          invocation.output.contentType === undefined ||
          invocation.output.contentType === null
            ? null
            : validateContentType(invocation.output.contentType);
        mergeReference(references, {
          storageKey,
          byteLength: null,
          contentType,
        });
      }
    }
  }
  return references;
}

function validateGraph(snapshot: ConversationGraphSnapshot): void {
  const rootId = snapshot.conversation.rootBranchId;
  const root = snapshot.branches[rootId];
  if (!root || root.parentId) {
    fail("graph_orphan", "Conversation root branch is missing or has a parent");
  }

  const states = new Map<string, "visiting" | "visited">();
  const visit = (branchId: string): void => {
    const state = states.get(branchId);
    if (state === "visiting") {
      fail("graph_cycle", "Conversation branch graph contains a cycle");
    }
    if (state === "visited") {
      return;
    }
    const branch = snapshot.branches[branchId];
    if (!branch) {
      fail("graph_orphan", "Conversation branch parent is missing");
    }
    states.set(branchId, "visiting");
    if (branch.parentId) {
      visit(branch.parentId);
    } else if (branchId !== rootId) {
      fail("graph_orphan", "Conversation contains a detached branch root");
    }
    states.set(branchId, "visited");
  };

  for (const branchId of Object.keys(snapshot.branches)) {
    visit(branchId);
  }

  const referencedMessageIds = new Set<string>();
  for (const branch of Object.values(snapshot.branches)) {
    for (const messageId of branch.messageIds) {
      if (referencedMessageIds.has(messageId)) {
        fail(
          "duplicate_message_reference",
          "Conversation message is referenced more than once",
        );
      }
      referencedMessageIds.add(messageId);
    }
  }
  for (const message of Object.values(snapshot.messages)) {
    if (
      !snapshot.branches[message.branchId] ||
      !referencedMessageIds.has(message.id)
    ) {
      fail("graph_orphan", "Conversation contains an orphaned message");
    }
  }
  if (referencedMessageIds.size !== Object.keys(snapshot.messages).length) {
    fail("graph_orphan", "Conversation references a missing message");
  }
}

function validatedCanonicalSnapshot(value: unknown): {
  snapshot: ConversationGraphSnapshot;
  canonical: string;
} {
  let snapshot: ConversationGraphSnapshot;
  try {
    snapshot = validateConversationGraphSnapshot(value);
  } catch (error) {
    fail("invalid_snapshot", "Conversation snapshot is invalid", error);
  }
  validateGraph(snapshot);
  const canonical = canonicalJson(snapshot);
  return { snapshot, canonical };
}

function compareConversationIds(
  left: { conversationId: string },
  right: { conversationId: string },
): number {
  return left.conversationId < right.conversationId
    ? -1
    : left.conversationId > right.conversationId
      ? 1
      : 0;
}

function validateExportConversations(
  values: readonly ConversationGraphSnapshot[],
  limits: BranchyArchiveLimits,
): Array<{
  conversationId: string;
  snapshot: ConversationGraphSnapshot;
  canonicalSnapshot: ConversationGraphSnapshot;
  canonical: string;
}> {
  if (values.length === 0) {
    fail(
      "empty_conversation_set",
      "Archive export requires at least one conversation",
    );
  }
  if (values.length > limits.maxConversations) {
    fail(
      "too_many_conversations",
      "Archive export contains too many conversations",
    );
  }

  const conversationIds = new Set<string>();
  const conversations = values.map((value) => {
    const { snapshot, canonical } = validatedCanonicalSnapshot(value);
    const conversationId = snapshot.conversation.id;
    if (conversationIds.has(conversationId)) {
      fail(
        "duplicate_conversation_id",
        "Archive export repeats a conversation ID",
      );
    }
    conversationIds.add(conversationId);
    return {
      conversationId,
      snapshot,
      canonicalSnapshot: JSON.parse(canonical) as ConversationGraphSnapshot,
      canonical,
    };
  });
  return conversations.sort(compareConversationIds);
}

function normalizeExportAssets(
  input: readonly BranchyArchiveAssetInput[],
  references: ReadonlyMap<string, AssetReference>,
): Array<{
  descriptor: BranchyArchiveManifestAsset;
  bytes: Uint8Array;
}> {
  const supplied = new Map<string, BranchyArchiveAssetInput>();
  for (const asset of input) {
    const storageKey = validateStorageKey(asset.storageKey);
    if (supplied.has(storageKey)) {
      fail("duplicate_storage_key", "Archive export repeats an asset storage key");
    }
    if (!(asset.bytes instanceof Uint8Array)) {
      fail("invalid_asset", "Archive asset must be provided as bytes");
    }
    supplied.set(storageKey, asset);
  }

  for (const storageKey of supplied.keys()) {
    if (!references.has(storageKey)) {
      fail("unexpected_asset", "Archive export includes an unreferenced asset");
    }
  }

  const result: Array<{
    descriptor: BranchyArchiveManifestAsset;
    bytes: Uint8Array;
  }> = [];
  for (const storageKey of [...references.keys()].sort()) {
    const reference = references.get(storageKey);
    const asset = supplied.get(storageKey);
    if (!reference || !asset) {
      fail("missing_asset", "Archive export is missing a referenced asset");
    }
    if (
      reference.byteLength !== null &&
      reference.byteLength !== asset.bytes.byteLength
    ) {
      fail(
        "invalid_asset",
        "Archive asset size does not match its snapshot reference",
      );
    }

    const suppliedContentType =
      asset.contentType === undefined || asset.contentType === null
        ? null
        : validateContentType(asset.contentType);
    if (
      reference.contentType !== null &&
      suppliedContentType !== null &&
      reference.contentType !== suppliedContentType
    ) {
      fail(
        "invalid_asset",
        "Archive asset content type does not match its snapshot reference",
      );
    }
    const digest = sha256(asset.bytes);
    result.push({
      descriptor: {
        storageKey,
        path: assetPath(digest),
        byteLength: asset.bytes.byteLength,
        sha256: digest,
        contentType: reference.contentType ?? suppliedContentType,
      },
      bytes: asset.bytes,
    });
  }
  return result;
}

function parseManifest(
  value: unknown,
  limits: BranchyArchiveLimits,
): BranchyArchiveManifestV1 {
  if (!isPlainRecord(value)) {
    fail("invalid_manifest", "Archive manifest must be an object");
  }
  assertExactKeys(value, MANIFEST_KEYS, "Archive manifest");
  if (
    value.format !== BRANCHY_CHAT_ARCHIVE_FORMAT ||
    value.version !== BRANCHY_CHAT_ARCHIVE_VERSION ||
    !Array.isArray(value.conversations) ||
    !Array.isArray(value.assets)
  ) {
    fail("invalid_manifest", "Archive manifest header is invalid");
  }
  if (value.conversations.length === 0) {
    fail(
      "empty_conversation_set",
      "Archive manifest must contain at least one conversation",
    );
  }
  if (value.conversations.length > limits.maxConversations) {
    fail(
      "too_many_conversations",
      "Archive manifest contains too many conversations",
    );
  }

  const conversationIds = new Set<string>();
  const conversations = value.conversations.map(
    (item): BranchyArchiveManifestConversation => {
      if (!isPlainRecord(item)) {
        fail(
          "invalid_manifest",
          "Archive manifest conversation must be an object",
        );
      }
      assertExactKeys(
        item,
        MANIFEST_CONVERSATION_KEYS,
        "Archive manifest conversation",
      );
      if (
        typeof item.conversationId !== "string" ||
        item.conversationId.length === 0 ||
        typeof item.snapshotSha256 !== "string" ||
        !SHA256_PATTERN.test(item.snapshotSha256)
      ) {
        fail(
          "invalid_manifest",
          "Archive manifest conversation metadata is invalid",
        );
      }
      if (conversationIds.has(item.conversationId)) {
        fail(
          "duplicate_conversation_id",
          "Archive manifest repeats a conversation ID",
        );
      }
      conversationIds.add(item.conversationId);
      return {
        conversationId: item.conversationId,
        snapshot: item.snapshot as ConversationGraphSnapshot,
        snapshotSha256: item.snapshotSha256,
      };
    },
  );

  const assets = value.assets.map((item): BranchyArchiveManifestAsset => {
    if (!isPlainRecord(item)) {
      fail("invalid_manifest", "Archive manifest asset must be an object");
    }
    assertExactKeys(item, MANIFEST_ASSET_KEYS, "Archive manifest asset");
    const storageKey = validateStorageKey(item.storageKey);
    if (
      typeof item.path !== "string" ||
      typeof item.sha256 !== "string" ||
      !SHA256_PATTERN.test(item.sha256) ||
      !Number.isSafeInteger(item.byteLength) ||
      (item.byteLength as number) < 0
    ) {
      fail("invalid_manifest", "Archive manifest asset metadata is invalid");
    }
    if (item.path !== assetPath(item.sha256)) {
      fail(
        "invalid_manifest",
        "Archive asset path does not match its checksum",
      );
    }
    return {
      storageKey,
      path: item.path,
      byteLength: item.byteLength as number,
      sha256: item.sha256,
      contentType: validateContentType(item.contentType),
    };
  });

  return {
    format: BRANCHY_CHAT_ARCHIVE_FORMAT,
    version: BRANCHY_CHAT_ARCHIVE_VERSION,
    conversations,
    assets,
  };
}

function validateImportedAssets(
  manifest: BranchyArchiveManifestV1,
  files: ReadonlyMap<string, Uint8Array>,
  references: ReadonlyMap<string, AssetReference>,
  limits: BranchyArchiveLimits,
): StagedBranchyArchiveAsset[] {
  if (manifest.assets.length > limits.maxEntries - 1) {
    fail("too_many_entries", "Archive manifest lists too many assets");
  }

  const descriptors = new Map<string, BranchyArchiveManifestAsset>();
  const physicalFiles = new Map<string, BranchyArchiveManifestAsset>();
  for (const descriptor of manifest.assets) {
    if (descriptors.has(descriptor.storageKey)) {
      fail(
        "duplicate_storage_key",
        "Archive manifest repeats an asset storage key",
      );
    }
    descriptors.set(descriptor.storageKey, descriptor);
    const priorPhysical = physicalFiles.get(descriptor.path);
    if (
      priorPhysical &&
      (priorPhysical.sha256 !== descriptor.sha256 ||
        priorPhysical.byteLength !== descriptor.byteLength)
    ) {
      fail("invalid_manifest", "Archive asset path metadata conflicts");
    }
    physicalFiles.set(descriptor.path, descriptor);
  }

  for (const storageKey of descriptors.keys()) {
    if (!references.has(storageKey)) {
      fail("unexpected_asset", "Archive contains an unreferenced asset");
    }
  }
  for (const [storageKey, reference] of references) {
    const descriptor = descriptors.get(storageKey);
    if (!descriptor) {
      fail("missing_asset", "Archive is missing a referenced asset");
    }
    if (
      (reference.byteLength !== null &&
        reference.byteLength !== descriptor.byteLength) ||
      (reference.contentType !== null &&
        reference.contentType !== descriptor.contentType)
    ) {
      fail(
        "invalid_asset",
        "Archive asset metadata does not match the snapshot",
      );
    }
  }

  const expectedPaths = new Set<string>([
    BRANCHY_CHAT_ARCHIVE_MANIFEST_PATH,
    ...physicalFiles.keys(),
  ]);
  for (const path of files.keys()) {
    if (!expectedPaths.has(path)) {
      fail("unexpected_archive_entry", "Archive contains an unexpected entry");
    }
  }
  for (const path of expectedPaths) {
    if (!files.has(path)) {
      fail("missing_archive_entry", "Archive is missing a declared entry");
    }
  }

  const validatedPhysical = new Map<string, Uint8Array>();
  for (const [path, descriptor] of physicalFiles) {
    const bytes = files.get(path);
    if (!bytes) {
      fail("missing_archive_entry", "Archive asset entry is missing");
    }
    if (
      bytes.byteLength !== descriptor.byteLength ||
      sha256(bytes) !== descriptor.sha256
    ) {
      fail("checksum_mismatch", "Archive asset checksum does not match");
    }
    validatedPhysical.set(path, bytes);
  }

  return manifest.assets.map((descriptor) => {
    const bytes = validatedPhysical.get(descriptor.path);
    if (!bytes) {
      fail("missing_archive_entry", "Validated archive asset entry is missing");
    }
    return {
      storageKey: descriptor.storageKey,
      byteLength: descriptor.byteLength,
      sha256: descriptor.sha256,
      contentType: descriptor.contentType,
      // Transfer the archive-owned extraction buffer into the staged value.
      // No other caller can observe the private files map after staging.
      bytes,
    };
  });
}

export function exportBranchyChatArchive(
  input: BranchyArchiveExportInput,
  limitOverrides?: Partial<BranchyArchiveLimits>,
): Uint8Array {
  const limits = resolveArchiveLimits(limitOverrides);
  const conversations = validateExportConversations(input.snapshots, limits);
  const references = collectAssetReferences(
    conversations.map(({ snapshot }) => snapshot),
  );
  const assets = normalizeExportAssets(input.assets, references);
  const manifest: BranchyArchiveManifestV1 = {
    format: BRANCHY_CHAT_ARCHIVE_FORMAT,
    version: BRANCHY_CHAT_ARCHIVE_VERSION,
    conversations: conversations.map(
      ({ conversationId, canonicalSnapshot, canonical }) => ({
        conversationId,
        snapshot: canonicalSnapshot,
        snapshotSha256: sha256(encodeUtf8(canonical)),
      }),
    ),
    assets: assets.map(({ descriptor }) => descriptor),
  };
  const manifestBytes = encodeUtf8(canonicalJson(manifest));
  if (manifestBytes.byteLength > limits.maxManifestBytes) {
    fail("manifest_too_large", "Archive manifest exceeds its size limit");
  }

  const physicalAssets = new Map<string, Uint8Array>();
  for (const { descriptor, bytes } of assets) {
    const prior = physicalAssets.get(descriptor.path);
    if (
      prior &&
      (prior.byteLength !== bytes.byteLength ||
        !prior.every((value, index) => value === bytes[index]))
    ) {
      fail("checksum_mismatch", "Archive asset checksum collision detected");
    }
    physicalAssets.set(descriptor.path, bytes);
  }

  return createDeterministicZip(
    [
      { path: BRANCHY_CHAT_ARCHIVE_MANIFEST_PATH, bytes: manifestBytes },
      ...[...physicalAssets.entries()]
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([path, bytes]) => ({ path, bytes })),
    ],
    limits,
  );
}

export function stageBranchyChatArchive(
  archive: Uint8Array,
  limitOverrides?: Partial<BranchyArchiveLimits>,
): StagedBranchyArchive {
  const limits = resolveArchiveLimits(limitOverrides);
  const files = extractValidatedZip(archive, limits);
  const manifestBytes = files.get(BRANCHY_CHAT_ARCHIVE_MANIFEST_PATH);
  if (!manifestBytes) {
    fail("missing_archive_entry", "Archive manifest is missing");
  }
  if (manifestBytes.byteLength > limits.maxManifestBytes) {
    fail("manifest_too_large", "Archive manifest exceeds its size limit");
  }

  let parsedManifest: unknown;
  try {
    parsedManifest = JSON.parse(decodeUtf8(manifestBytes, "Archive manifest"));
  } catch (error) {
    if (error instanceof BranchyArchiveError) {
      throw error;
    }
    fail("invalid_manifest", "Archive manifest is not valid JSON", error);
  }
  const manifest = parseManifest(parsedManifest, limits);
  const snapshots = manifest.conversations
    .map((conversation) => {
      const rawSnapshotCanonical = canonicalJson(conversation.snapshot);
      const { snapshot, canonical: validatedSnapshotCanonical } =
        validatedCanonicalSnapshot(conversation.snapshot);
      if (rawSnapshotCanonical !== validatedSnapshotCanonical) {
        fail(
          "invalid_snapshot",
          "Archive snapshot contains unknown or non-canonical fields",
        );
      }
      if (snapshot.conversation.id !== conversation.conversationId) {
        fail(
          "invalid_manifest",
          "Archive conversation ID does not match its snapshot",
        );
      }
      if (
        sha256(encodeUtf8(rawSnapshotCanonical)) !==
        conversation.snapshotSha256
      ) {
        fail("checksum_mismatch", "Archive snapshot checksum does not match");
      }
      return snapshot;
    })
    .sort((left, right) =>
      compareConversationIds(
        { conversationId: left.conversation.id },
        { conversationId: right.conversation.id },
      ),
    );

  const validatedIds = new Set<string>();
  for (const snapshot of snapshots) {
    if (validatedIds.has(snapshot.conversation.id)) {
      fail(
        "duplicate_conversation_id",
        "Archive contains duplicate validated conversation IDs",
      );
    }
    validatedIds.add(snapshot.conversation.id);
  }

  const references = collectAssetReferences(snapshots);
  const assets = validateImportedAssets(
    manifest,
    files,
    references,
    limits,
  );
  return {
    format: BRANCHY_CHAT_ARCHIVE_FORMAT,
    version: BRANCHY_CHAT_ARCHIVE_VERSION,
    snapshots,
    assets,
  };
}

/**
 * Validates and stages the complete archive before invoking the destination.
 * The adapter is never called for malformed or incomplete input.
 */
export async function importBranchyChatArchive<TResult>(
  archive: Uint8Array,
  adapter: BranchyArchiveImportAdapter<TResult>,
  limitOverrides?: Partial<BranchyArchiveLimits>,
): Promise<TResult> {
  const staged = stageBranchyChatArchive(archive, limitOverrides);
  if (!adapter || typeof adapter.commitArchive !== "function") {
    fail("invalid_asset", "Archive import adapter is invalid");
  }
  return await adapter.commitArchive(staged);
}
