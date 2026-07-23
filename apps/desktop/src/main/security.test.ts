import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  isAllowedExternalUrl,
  isTrustedRendererUrl,
  resolveRendererAsset,
} from "./security.ts";

test("external links allow HTTPS only", () => {
  assert.equal(isAllowedExternalUrl("https://example.com/path"), true);
  assert.equal(isAllowedExternalUrl("http://example.com"), false);
  assert.equal(isAllowedExternalUrl("file:///tmp/private"), false);
  assert.equal(isAllowedExternalUrl("javascript:alert(1)"), false);
  assert.equal(isAllowedExternalUrl(" https://example.com"), false);
});

test("trusted renderer URLs are bound to the app or exact dev origin", () => {
  assert.equal(isTrustedRendererUrl("branchy://renderer/index.html"), true);
  assert.equal(isTrustedRendererUrl("branchy://other/index.html"), false);
  assert.equal(
    isTrustedRendererUrl(
      "http://127.0.0.1:5173/src/main.ts",
      "http://127.0.0.1:5173",
    ),
    true,
  );
  assert.equal(
    isTrustedRendererUrl(
      "http://127.0.0.1:5174/src/main.ts",
      "http://127.0.0.1:5173",
    ),
    false,
  );
});

test("renderer asset resolution rejects traversal and symlink escapes", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "branchy-protocol-"));
  const rendererRoot = join(fixtureRoot, "renderer");
  const outsidePath = join(fixtureRoot, "outside.txt");
  mkdirSync(rendererRoot);
  writeFileSync(join(rendererRoot, "index.html"), "ok");
  writeFileSync(outsidePath, "private");
  symlinkSync(outsidePath, join(rendererRoot, "escape.txt"));

  assert.equal(
    resolveRendererAsset(rendererRoot, "/index.html"),
    realpathSync(join(rendererRoot, "index.html")),
  );
  assert.equal(resolveRendererAsset(rendererRoot, "/../outside.txt"), null);
  assert.equal(resolveRendererAsset(rendererRoot, "/%2e%2e/outside.txt"), null);
  assert.equal(resolveRendererAsset(rendererRoot, "/..%5coutside.txt"), null);
  assert.equal(resolveRendererAsset(rendererRoot, "/escape.txt"), null);
  assert.equal(resolveRendererAsset(rendererRoot, "/missing.txt"), null);
});
