import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import type { ConversationGraphSnapshot } from "@branchy/conversation-core";
import {
  strFromU8,
  strToU8,
  unzipSync,
  zipSync,
  type Zippable,
} from "fflate";

import {
  BranchyArchiveError,
  DEFAULT_BRANCHY_ARCHIVE_LIMITS,
  exportBranchyChatArchive,
  importBranchyChatArchive,
  stageBranchyChatArchive,
} from "./index.ts";

const CREATED_AT = "2026-07-23T00:00:00.000Z";
const ATTACHMENT_KEY =
  "conversations/conversation/attachments/attachment-1/notes.txt";
const GENERATED_IMAGE_KEY =
  "generated/conversation/assistant-child/generated-image-1";
const ATTACHMENT_BYTES = strToU8("notes");
const IMAGE_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const ZIP_MTIME = new Date(1980, 0, 1, 0, 0, 0, 0);
const REGULAR_FILE_ATTRIBUTES = (0o100600 * 65_536) >>> 0;

function fixtureSnapshot(
  conversationId = "conversation",
): ConversationGraphSnapshot {
  return {
    conversation: {
      id: conversationId,
      rootBranchId: "root",
      createdAt: CREATED_AT,
      settings: {
        model: "gpt-5.6-terra",
        temperature: 0,
        composerDefaults: { preset: "fast", tools: [] },
      },
    },
    branches: {
      root: {
        id: "root",
        parentId: null,
        title: "Root",
        createdFrom: { messageId: "user-root" },
        messageIds: ["user-root", "assistant-root"],
        createdAt: CREATED_AT,
      },
      child: {
        id: "child",
        parentId: "root",
        title: "Child",
        createdFrom: { messageId: "assistant-root" },
        messageIds: ["assistant-child"],
        createdAt: CREATED_AT,
      },
    },
    messages: {
      "user-root": {
        id: "user-root",
        branchId: "root",
        role: "user",
        content: "Read my notes",
        createdAt: CREATED_AT,
        attachments: [
          {
            id: "attachment-1",
            kind: "file",
            name: "notes.txt",
            contentType: "text/plain",
            size: ATTACHMENT_BYTES.byteLength,
            storageKey: ATTACHMENT_KEY,
            uploadedAt: CREATED_AT,
          },
        ],
      },
      "assistant-root": {
        id: "assistant-root",
        branchId: "root",
        role: "assistant",
        content: "Done",
        createdAt: CREATED_AT,
      },
      "assistant-child": {
        id: "assistant-child",
        branchId: "child",
        role: "assistant",
        content: "![generated image](branchy://asset/generated-image-1)",
        createdAt: CREATED_AT,
        toolInvocations: [
          {
            id: "generated-image-1",
            toolType: "image_generation",
            status: "succeeded",
            startedAt: CREATED_AT,
            completedAt: CREATED_AT,
            output: {
              storageKey: GENERATED_IMAGE_KEY,
              contentType: "image/png",
            },
          },
        ],
      },
    },
    canvas: {
      version: 2,
      viewport: { x: 0, y: 0, zoom: 1 },
      focusedBranchId: "child",
      nodes: {
        root: {
          branchId: "root",
          x: 0,
          y: 0,
          folded: false,
          expanded: true,
        },
        child: {
          branchId: "child",
          x: 800,
          y: 0,
          folded: false,
          expanded: true,
        },
      },
    },
  };
}

function fixtureAssets() {
  return [
    {
      storageKey: ATTACHMENT_KEY,
      bytes: ATTACHMENT_BYTES,
      contentType: "text/plain",
    },
    {
      storageKey: GENERATED_IMAGE_KEY,
      bytes: IMAGE_BYTES,
      contentType: "image/png",
    },
  ] as const;
}

function expectArchiveError(
  operation: () => unknown,
  expectedCode: BranchyArchiveError["code"],
): void {
  assert.throws(operation, (error: unknown) => {
    assert.ok(error instanceof BranchyArchiveError);
    assert.equal(error.code, expectedCode);
    return true;
  });
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function sha256Text(value: string): string {
  return createHash("sha256").update(strToU8(value)).digest("hex");
}

function rezip(files: Readonly<Record<string, Uint8Array>>): Uint8Array {
  const zippable = Object.create(null) as Zippable;
  for (const [path, bytes] of Object.entries(files).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  )) {
    zippable[path] = [
      bytes,
      {
        level: 0,
        mtime: ZIP_MTIME,
        os: 3,
        attrs: REGULAR_FILE_ATTRIBUTES,
      },
    ];
  }
  return zipSync(zippable, {
    level: 0,
    mtime: ZIP_MTIME,
    os: 3,
    attrs: REGULAR_FILE_ATTRIBUTES,
  });
}

function rewriteManifest(
  archive: Uint8Array,
  mutate: (manifest: Record<string, unknown>) => void,
): Uint8Array {
  const files = unzipSync(archive);
  const manifest = JSON.parse(
    strFromU8(files["manifest.json"]),
  ) as Record<string, unknown>;
  mutate(manifest);
  files["manifest.json"] = strToU8(canonicalJson(manifest));
  return rezip(files);
}

function rewriteSnapshot(
  archive: Uint8Array,
  mutate: (snapshot: ConversationGraphSnapshot) => void,
): Uint8Array {
  return rewriteManifest(archive, (manifest) => {
    const conversations = manifest.conversations as Array<
      Record<string, unknown>
    >;
    const conversation = conversations[0];
    const snapshot = conversation.snapshot as ConversationGraphSnapshot;
    mutate(snapshot);
    conversation.snapshotSha256 = sha256Text(canonicalJson(snapshot));
  });
}

test("archive export deterministically round-trips a conversation set with shared assets", async () => {
  const firstSnapshot = fixtureSnapshot("conversation");
  const secondSnapshot = fixtureSnapshot("conversation-2");
  const first = exportBranchyChatArchive({
    snapshots: [secondSnapshot, firstSnapshot],
    assets: fixtureAssets(),
  });
  const second = exportBranchyChatArchive({
    snapshots: [firstSnapshot, secondSnapshot],
    assets: [...fixtureAssets()].reverse(),
  });
  assert.deepEqual(first, second);

  const staged = stageBranchyChatArchive(first);
  assert.deepEqual(
    staged.snapshots.map((snapshot) => snapshot.conversation.id),
    ["conversation", "conversation-2"],
  );
  assert.deepEqual(
    staged.assets.map((asset) => asset.storageKey),
    [ATTACHMENT_KEY, GENERATED_IMAGE_KEY],
  );
  assert.deepEqual(staged.assets[0]?.bytes, ATTACHMENT_BYTES);
  assert.deepEqual(staged.assets[1]?.bytes, IMAGE_BYTES);
  assert.equal(
    Object.keys(unzipSync(first)).filter((path) => path.startsWith("assets/"))
      .length,
    2,
  );

  let adapterCalls = 0;
  const importedConversationIds = await importBranchyChatArchive(first, {
    commitArchive(value) {
      adapterCalls += 1;
      assert.equal(value.assets.length, 2);
      return value.snapshots.map((snapshot) => snapshot.conversation.id);
    },
  });
  assert.deepEqual(importedConversationIds, [
    "conversation",
    "conversation-2",
  ]);
  assert.equal(adapterCalls, 1);
});

test("conversation sets must be non-empty, bounded, and uniquely identified", () => {
  expectArchiveError(
    () => exportBranchyChatArchive({ snapshots: [], assets: [] }),
    "empty_conversation_set",
  );
  expectArchiveError(
    () =>
      exportBranchyChatArchive({
        snapshots: [fixtureSnapshot(), fixtureSnapshot()],
        assets: fixtureAssets(),
      }),
    "duplicate_conversation_id",
  );
  expectArchiveError(
    () =>
      exportBranchyChatArchive(
        {
          snapshots: [
            fixtureSnapshot("conversation"),
            fixtureSnapshot("conversation-2"),
          ],
          assets: fixtureAssets(),
        },
        { maxConversations: 1 },
      ),
    "too_many_conversations",
  );

  const archive = exportBranchyChatArchive({
    snapshots: [fixtureSnapshot()],
    assets: fixtureAssets(),
  });
  const duplicateManifestId = rewriteManifest(archive, (manifest) => {
    const conversations = manifest.conversations as Array<
      Record<string, unknown>
    >;
    conversations.push(structuredClone(conversations[0]));
  });
  expectArchiveError(
    () => stageBranchyChatArchive(duplicateManifestId),
    "duplicate_conversation_id",
  );

  const emptyManifestSet = rewriteManifest(archive, (manifest) => {
    manifest.conversations = [];
  });
  expectArchiveError(
    () => stageBranchyChatArchive(emptyManifestSet),
    "empty_conversation_set",
  );
});

test("in-memory staging accepts its exact envelope and rejects one byte over it", () => {
  assert.deepEqual(DEFAULT_BRANCHY_ARCHIVE_LIMITS, {
    maxArchiveBytes: 72 * 1024 * 1024,
    maxEntries: 513,
    maxConversations: 256,
    maxEntryBytes: 32 * 1024 * 1024,
    maxTotalUncompressedBytes: 64 * 1024 * 1024,
    maxCompressionRatio: 250,
    maxPathDepth: 3,
    maxManifestBytes: 8 * 1024 * 1024,
  });

  const archive = exportBranchyChatArchive({
    snapshots: [fixtureSnapshot()],
    assets: fixtureAssets(),
  });
  const files = unzipSync(archive);
  const sizes = Object.values(files).map((bytes) => bytes.byteLength);
  const totalBytes = sizes.reduce((total, size) => total + size, 0);
  const exactLimits = {
    maxArchiveBytes: archive.byteLength,
    maxEntries: sizes.length,
    maxConversations: 1,
    maxEntryBytes: Math.max(...sizes),
    maxTotalUncompressedBytes: totalBytes,
    maxCompressionRatio: 1,
    maxPathDepth: 2,
    maxManifestBytes: files["manifest.json"].byteLength,
  };

  assert.doesNotThrow(() => stageBranchyChatArchive(archive, exactLimits));
  expectArchiveError(
    () =>
      stageBranchyChatArchive(archive, {
        ...exactLimits,
        maxTotalUncompressedBytes: totalBytes - 1,
      }),
    "total_size_exceeded",
  );
});

test("ZIP preflight rejects traversal, compression bombs, symlinks, and normalized duplicates", () => {
  const unsafePathArchive = zipSync(
    {
      "../manifest.json": [
        strToU8("{}"),
        {
          level: 0,
          mtime: ZIP_MTIME,
          os: 3,
          attrs: REGULAR_FILE_ATTRIBUTES,
        },
      ],
    },
    { level: 0, mtime: ZIP_MTIME, os: 3 },
  );
  expectArchiveError(
    () => stageBranchyChatArchive(unsafePathArchive),
    "unsafe_entry_path",
  );

  const bombArchive = zipSync(
    {
      "manifest.json": [
        new Uint8Array(2 * 1024 * 1024),
        {
          level: 9,
          mtime: ZIP_MTIME,
          os: 3,
          attrs: REGULAR_FILE_ATTRIBUTES,
        },
      ],
    },
    { level: 9, mtime: ZIP_MTIME, os: 3 },
  );
  expectArchiveError(
    () => stageBranchyChatArchive(bombArchive),
    "compression_ratio_exceeded",
  );

  const symlinkArchive = zipSync(
    {
      "manifest.json": [
        strToU8("{}"),
        {
          level: 0,
          mtime: ZIP_MTIME,
          os: 3,
          attrs: (0o120777 * 65_536) >>> 0,
        },
      ],
    },
    { level: 0, mtime: ZIP_MTIME, os: 3 },
  );
  expectArchiveError(
    () => stageBranchyChatArchive(symlinkArchive),
    "unsupported_entry_type",
  );

  const duplicateUnicodeArchive = zipSync(
    {
      "assets/\u00e9": [
        new Uint8Array([1]),
        {
          level: 0,
          mtime: ZIP_MTIME,
          os: 3,
          attrs: REGULAR_FILE_ATTRIBUTES,
        },
      ],
      "assets/e\u0301": [
        new Uint8Array([2]),
        {
          level: 0,
          mtime: ZIP_MTIME,
          os: 3,
          attrs: REGULAR_FILE_ATTRIBUTES,
        },
      ],
    },
    { level: 0, mtime: ZIP_MTIME, os: 3 },
  );
  expectArchiveError(
    () => stageBranchyChatArchive(duplicateUnicodeArchive),
    "duplicate_entry_path",
  );
});

test("manifest and asset integrity failures are rejected before adapter mutation", async () => {
  const archive = exportBranchyChatArchive({
    snapshots: [fixtureSnapshot()],
    assets: fixtureAssets(),
  });

  expectArchiveError(
    () => stageBranchyChatArchive(archive.subarray(0, archive.byteLength - 1)),
    "unsupported_zip_feature",
  );

  const malformedManifest = zipSync(
    {
      "manifest.json": [
        strToU8("{"),
        {
          level: 0,
          mtime: ZIP_MTIME,
          os: 3,
          attrs: REGULAR_FILE_ATTRIBUTES,
        },
      ],
    },
    { level: 0, mtime: ZIP_MTIME, os: 3 },
  );
  expectArchiveError(
    () => stageBranchyChatArchive(malformedManifest),
    "invalid_manifest",
  );

  const unknownField = rewriteManifest(archive, (manifest) => {
    manifest.unexpected = true;
  });
  expectArchiveError(
    () => stageBranchyChatArchive(unknownField),
    "invalid_manifest",
  );

  const files = unzipSync(archive);
  const assetPath = Object.keys(files).find((path) => path.startsWith("assets/"));
  assert.ok(assetPath);
  files[assetPath][0] ^= 0xff;
  const tamperedAsset = rezip(files);
  expectArchiveError(
    () => stageBranchyChatArchive(tamperedAsset),
    "checksum_mismatch",
  );

  let adapterCalls = 0;
  await assert.rejects(
    importBranchyChatArchive(tamperedAsset, {
      commitArchive() {
        adapterCalls += 1;
      },
    }),
    BranchyArchiveError,
  );
  assert.equal(adapterCalls, 0);
});

test("graph cycles, orphans, duplicate message references, and unsafe storage keys are rejected", () => {
  const archive = exportBranchyChatArchive({
    snapshots: [fixtureSnapshot()],
    assets: fixtureAssets(),
  });

  const cycle = rewriteSnapshot(archive, (snapshot) => {
    snapshot.branches.child.parentId = "child";
  });
  expectArchiveError(() => stageBranchyChatArchive(cycle), "graph_cycle");

  const orphanBranch = rewriteSnapshot(archive, (snapshot) => {
    snapshot.branches.child.parentId = "missing";
  });
  expectArchiveError(
    () => stageBranchyChatArchive(orphanBranch),
    "graph_orphan",
  );

  const duplicateMessage = rewriteSnapshot(archive, (snapshot) => {
    snapshot.branches.root.messageIds.push("user-root");
  });
  expectArchiveError(
    () => stageBranchyChatArchive(duplicateMessage),
    "duplicate_message_reference",
  );

  const unsafeStorageKey = rewriteSnapshot(archive, (snapshot) => {
    const attachment = snapshot.messages["user-root"].attachments?.[0];
    assert.ok(attachment);
    attachment.storageKey = "../escape";
  });
  expectArchiveError(
    () => stageBranchyChatArchive(unsafeStorageKey),
    "unsafe_storage_key",
  );
});
