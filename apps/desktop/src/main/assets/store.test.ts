import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";

import { AssetStoreError } from "./errors.ts";
import { safeDownloadFilename } from "./filename.ts";
import { resolveAppOwnedPath } from "./paths.ts";
import { AssetStore, assetUrl } from "./store.ts";

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x49, 0x45, 0x4e, 0x44,
]);
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43]);

interface StoreFixture {
  fixtureRoot: string;
  sourceRoot: string;
  store: AssetStore;
  storeRoot: string;
}

async function createStoreFixture(
  context: TestContext,
  options: {
    attachmentMaxBytes?: number;
    generatedImageMaxBytes?: number;
  } = {},
): Promise<StoreFixture> {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "branchy-assets-"));
  const sourceRoot = join(fixtureRoot, "codex-output");
  const storeRoot = join(fixtureRoot, "branchy-owned");
  await mkdir(sourceRoot, { mode: 0o700 });
  context.after(async () => {
    await rm(fixtureRoot, { force: true, recursive: true });
  });
  const store = await AssetStore.open({
    ...options,
    generatedImageSourceRoots: [sourceRoot],
    now: () => new Date("2026-07-23T08:00:00.000Z"),
    rootPath: storeRoot,
  });
  return { fixtureRoot, sourceRoot, store, storeRoot };
}

function hasAssetError(code: AssetStoreError["code"]): (error: unknown) => boolean {
  return (error: unknown): boolean =>
    error instanceof AssetStoreError && error.code === code;
}

test("attachment writes enforce the actual byte limit", async (context) => {
  const { store } = await createStoreFixture(context, {
    attachmentMaxBytes: PNG_BYTES.byteLength,
  });

  await assert.rejects(
    store.writeAttachment({
      bytes: Buffer.alloc(0),
      fileName: "empty.png",
      mimeType: "image/png",
    }),
    hasAssetError("ASSET_EMPTY"),
  );
  await assert.rejects(
    store.writeAttachment({
      bytes: Buffer.concat([PNG_BYTES, Buffer.from([0])]),
      fileName: "large.png",
      mimeType: "image/png",
    }),
    hasAssetError("ASSET_TOO_LARGE"),
  );

  const asset = await store.writeAttachment({
    bytes: PNG_BYTES,
    fileName: "exact.png",
    mimeType: "image/png",
  });
  assert.equal(asset.byteLength, PNG_BYTES.byteLength);
});

test("content hashes are stable and duplicate bytes use one object", async (context) => {
  const { store, storeRoot } = await createStoreFixture(context);
  const expectedHash = createHash("sha256").update(PNG_BYTES).digest("hex");

  const first = await store.writeAttachment({
    bytes: PNG_BYTES,
    fileName: "first.png",
    mimeType: "image/png",
  });
  const duplicate = await store.writeAttachment({
    bytes: PNG_BYTES,
    fileName: "second.png",
    mimeType: "image/png",
  });

  assert.equal(first.assetId, `asset_${expectedHash}`);
  assert.equal(duplicate.assetId, first.assetId);
  assert.equal(duplicate.relativePath, first.relativePath);
  assert.equal(duplicate.originalName, "first.png");
  assert.deepEqual(
    await readdir(join(storeRoot, "objects", expectedHash.slice(0, 2))),
    [`${expectedHash}.png`],
  );
  assert.deepEqual(await readFile(join(storeRoot, ...first.relativePath.split("/"))), PNG_BYTES);
});

test("file names reject traversal and backslashes and normalize Unicode", async (context) => {
  const { store } = await createStoreFixture(context);
  for (const fileName of ["../secret.txt", String.raw`folder\secret.txt`]) {
    await assert.rejects(
      store.writeAttachment({
        bytes: Buffer.from("hello", "utf8"),
        fileName,
        mimeType: "text/plain",
      }),
      hasAssetError("FILENAME_INVALID"),
    );
  }

  const normalized = await store.writeAttachment({
    bytes: Buffer.from("normalized", "utf8"),
    fileName: "Cafe\u0301 notes.txt",
    mimeType: "text/plain",
  });
  assert.equal(normalized.originalName, "Café notes.txt");
  assert.equal(normalized.originalName, normalized.originalName.normalize("NFC"));

  await assert.rejects(
    store.getAsset("../records/private"),
    hasAssetError("ASSET_ID_INVALID"),
  );
  await assert.rejects(
    store.getAsset(String.raw`asset_\..\private`),
    hasAssetError("ASSET_ID_INVALID"),
  );
  assert.throws(
    () => resolveAppOwnedPath(store.rootPath, String.raw`objects\escape.png`),
    hasAssetError("STORE_PATH_INVALID"),
  );
  assert.throws(
    () => resolveAppOwnedPath(store.rootPath, "objects/../escape.png"),
    hasAssetError("STORE_PATH_INVALID"),
  );
});

test("generated-image ingestion copies a regular Codex output into Branchy storage", async (context) => {
  const { sourceRoot, store } = await createStoreFixture(context);
  const savedPath = join(sourceRoot, "codex-result.png");
  await writeFile(savedPath, PNG_BYTES);

  const asset = await store.ingestGeneratedImage({
    declaredMimeType: "image/png",
    savedPath,
  });
  assert.equal(asset.source, "generated-image");
  assert.equal(asset.originalName, "codex-result.png");
  assert.equal(asset.mimeType, "image/png");

  const resolvedBeforeDelete = await store.resolveAssetFile(asset.assetId);
  assert.notEqual(resolvedBeforeDelete.absolutePath, savedPath);
  await unlink(savedPath);
  const resolvedAfterDelete = await store.resolveAssetFile(asset.assetId);
  assert.deepEqual(await readFile(resolvedAfterDelete.absolutePath), PNG_BYTES);
});

test("generated-image ingestion enforces its configured byte limit before reading", async (context) => {
  const { sourceRoot, store } = await createStoreFixture(context, {
    generatedImageMaxBytes: PNG_BYTES.byteLength - 1,
  });
  const savedPath = join(sourceRoot, "too-large.png");
  await writeFile(savedPath, PNG_BYTES);

  await assert.rejects(
    store.ingestGeneratedImage({ savedPath }),
    hasAssetError("ASSET_TOO_LARGE"),
  );
});

test("generated-image ingestion rejects outside paths and symlink escapes", async (context) => {
  const { fixtureRoot, sourceRoot, store } = await createStoreFixture(context);
  const outsidePath = join(fixtureRoot, "outside.png");
  const finalLink = join(sourceRoot, "linked.png");
  const outsideDirectory = join(fixtureRoot, "outside-directory");
  const directoryLink = join(sourceRoot, "linked-directory");
  await writeFile(outsidePath, PNG_BYTES);
  await mkdir(outsideDirectory);
  await writeFile(join(outsideDirectory, "nested.png"), PNG_BYTES);
  await symlink(outsidePath, finalLink);
  await symlink(outsideDirectory, directoryLink);

  await assert.rejects(
    store.ingestGeneratedImage({ savedPath: outsidePath }),
    hasAssetError("SOURCE_NOT_ALLOWED"),
  );
  await assert.rejects(
    store.ingestGeneratedImage({ savedPath: finalLink }),
    hasAssetError("SOURCE_NOT_REGULAR"),
  );
  await assert.rejects(
    store.ingestGeneratedImage({
      savedPath: join(directoryLink, "nested.png"),
    }),
    hasAssetError("SOURCE_NOT_ALLOWED"),
  );
});

test("stored object lookup rejects a symlink replacement", async (context) => {
  const { fixtureRoot, store, storeRoot } = await createStoreFixture(context);
  const asset = await store.writeAttachment({
    bytes: PNG_BYTES,
    fileName: "safe.png",
    mimeType: "image/png",
  });
  const objectPath = join(storeRoot, ...asset.relativePath.split("/"));
  const outsidePath = join(fixtureRoot, "outside-same-size.png");
  await writeFile(outsidePath, PNG_BYTES);
  await unlink(objectPath);
  await symlink(outsidePath, objectPath);
  assert.equal((await lstat(objectPath)).isSymbolicLink(), true);

  await assert.rejects(
    store.resolveAssetFile(asset.assetId),
    hasAssetError("ASSET_CORRUPT"),
  );
});

test("MIME sniffing and filename extensions must agree with file contents", async (context) => {
  const { sourceRoot, store } = await createStoreFixture(context);

  await assert.rejects(
    store.writeAttachment({
      bytes: PNG_BYTES,
      fileName: "wrong.png",
      mimeType: "image/jpeg",
    }),
    hasAssetError("MIME_MISMATCH"),
  );
  await assert.rejects(
    store.writeAttachment({
      bytes: PNG_BYTES,
      fileName: "wrong.jpg",
      mimeType: "image/png",
    }),
    hasAssetError("MIME_EXTENSION_MISMATCH"),
  );
  await assert.rejects(
    store.writeAttachment({
      bytes: Buffer.from([0, 1, 2, 3]),
      fileName: "unknown.bin",
      mimeType: "application/octet-stream",
    }),
    hasAssetError("UNSUPPORTED_MIME"),
  );

  const jpeg = await store.writeAttachment({
    bytes: JPEG_BYTES,
    fileName: "photo.jpeg",
    mimeType: "image/jpeg",
  });
  assert.match(jpeg.relativePath, /\.jpg$/u);

  const generatedWrongExtension = join(sourceRoot, "generated.jpg");
  await writeFile(generatedWrongExtension, PNG_BYTES);
  await assert.rejects(
    store.ingestGeneratedImage({ savedPath: generatedWrongExtension }),
    hasAssetError("MIME_EXTENSION_MISMATCH"),
  );

  const generatedText = join(sourceRoot, "not-an-image.txt");
  await writeFile(generatedText, "plain text", "utf8");
  await assert.rejects(
    store.ingestGeneratedImage({ savedPath: generatedText }),
    hasAssetError("UNSUPPORTED_MIME"),
  );
});

test("download metadata returns a safe filename and never a raw file URL", async (context) => {
  const { store } = await createStoreFixture(context);
  const asset = await store.writeAttachment({
    bytes: PNG_BYTES,
    fileName: "original.png",
    mimeType: "image/png",
  });

  const metadata = await store.downloadMetadata(
    asset.assetId,
    "../folder\\CON.exe\n",
  );
  assert.deepEqual(metadata, {
    assetId: asset.assetId,
    byteLength: PNG_BYTES.byteLength,
    mimeType: "image/png",
    suggestedFilename: "branchy-CON.png",
  });
  assert.equal(
    safeDownloadFilename("Cafe\u0301 art.jpeg", "image/jpeg"),
    "Café art.jpg",
  );
  assert.equal(assetUrl(asset.assetId), `branchy-asset://asset/${asset.assetId}`);
  assert.equal(assetUrl(asset.assetId).startsWith("file:"), false);
  assert.equal(JSON.stringify(metadata).includes(store.rootPath), false);
  assert.equal(JSON.stringify(metadata).includes(asset.relativePath), false);
});

test("asset deletion is idempotent after removing metadata and bytes", async (context) => {
  const { store } = await createStoreFixture(context);
  const asset = await store.writeAttachment({
    bytes: PNG_BYTES,
    fileName: "delete-me.png",
    mimeType: "image/png",
  });

  assert.equal(await store.deleteAsset(asset.assetId), true);
  assert.equal(await store.deleteAsset(asset.assetId), false);
  await assert.rejects(
    store.resolveAssetFile(asset.assetId),
    hasAssetError("ASSET_NOT_FOUND"),
  );
});
