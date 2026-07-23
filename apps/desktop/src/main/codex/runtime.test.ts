import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stat } from "node:fs/promises";
import { test } from "node:test";

import {
  buildCodexAppServerArguments,
  buildCodexChildEnvironment,
  codexExecutableKind,
  CODEX_DIRECTORY_MODE,
  CODEX_PRIVATE_FILE_MODE,
  prepareBranchyCodexRuntime,
  resolveCodexExecutable,
} from "./runtime.ts";

function permissions(mode: number): number {
  return mode & 0o777;
}

test("Branchy Codex runtime keeps auth and config in private app-owned paths", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "branchy-codex-runtime-"));
  context.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const runtime = await prepareBranchyCodexRuntime(root);

  assert.equal(
    permissions((await stat(runtime.codexHome)).mode),
    CODEX_DIRECTORY_MODE,
  );
  assert.equal(
    permissions((await stat(runtime.workspacePath)).mode),
    CODEX_DIRECTORY_MODE,
  );
  assert.equal(
    permissions((await stat(runtime.configPath)).mode),
    CODEX_PRIVATE_FILE_MODE,
  );
  assert.match(
    await readFile(runtime.configPath, "utf8"),
    /^cli_auth_credentials_store = "file"$/m,
  );
});

test("Codex child environment is allowlisted and cannot inherit app secrets", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "branchy-codex-env-"));
  context.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  const runtime = await prepareBranchyCodexRuntime(root);

  const environment = buildCodexChildEnvironment(runtime, {
    PATH: "/safe/bin",
    LANG: "en_ZA.UTF-8",
    HOME: "/Users/shared-app",
    CODEX_HOME: "/Users/shared-app/.codex",
    OPENAI_API_KEY: "must-not-leak",
    ANTHROPIC_API_KEY: "must-not-leak",
    HTTP_PROXY: "https://secret:password@example.invalid",
    RUST_LOG: "trace",
  });

  assert.equal(environment.OPENAI_API_KEY, undefined);
  assert.equal(environment.HTTP_PROXY, undefined);
  assert.deepEqual(environment, {
    PATH: "/safe/bin",
    LANG: "en_ZA.UTF-8",
    CODEX_HOME: runtime.codexHome,
    HOME: runtime.processHome,
    XDG_CONFIG_HOME: runtime.xdgConfigHome,
    XDG_CACHE_HOME: runtime.xdgCacheHome,
    XDG_DATA_HOME: runtime.xdgDataHome,
    XDG_STATE_HOME: runtime.xdgStateHome,
  });
});

test("app-server arguments force file auth and experimental realtime over stdio", () => {
  const args = buildCodexAppServerArguments();
  assert.deepEqual(args.slice(-2), ["--listen", "stdio://"]);
  assert(args.includes('cli_auth_credentials_store="file"'));
  assert(args.includes("features.realtime_conversation=true"));
  assert.equal(args.includes("--strict-config"), true);
  assert.equal(args.includes("app-server"), false);
  assert.equal(args.includes("--enable"), false);
  assert.deepEqual(
    buildCodexAppServerArguments("codex-cli").slice(0, 2),
    ["app-server", "--strict-config"],
  );
});

test("packaged and development Codex binary resolution use explicit hooks", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "branchy-codex-bin-"));
  context.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  const binary = join(root, "codex-aarch64-apple-darwin");
  const developmentLink = join(root, "codex");
  const resourcesPath = join(root, "Resources");
  const packagedBinary = join(
    resourcesPath,
    "codex",
    "bin",
    "codex-app-server",
  );
  await mkdir(join(resourcesPath, "codex", "bin"), {
    recursive: true,
  });
  await writeFile(packagedBinary, "#!/bin/sh\n", { mode: 0o700 });
  await writeFile(binary, "#!/bin/sh\n", { mode: 0o700 });
  await symlink(binary, developmentLink);

  assert.equal(
    resolveCodexExecutable({
      isPackaged: true,
      resourcesPath,
    }),
    packagedBinary,
  );
  assert.equal(
    resolveCodexExecutable({
      isPackaged: false,
      developmentExecutablePath: developmentLink,
    }),
    developmentLink,
  );
  assert.throws(
    () =>
      resolveCodexExecutable({
        isPackaged: true,
        bundledExecutablePath: join(root, "missing"),
      }),
    /packaged Branchy Chat Codex app-server binary is missing/,
  );
  assert.equal(
    codexExecutableKind(packagedBinary, true),
    "dedicated-app-server",
  );
  assert.equal(
    codexExecutableKind(developmentLink, false),
    "codex-cli",
  );
});
