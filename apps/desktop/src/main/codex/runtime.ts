import {
  constants,
  existsSync,
  lstatSync,
  statSync,
} from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
} from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";

export const CODEX_DIRECTORY_MODE = 0o700;
export const CODEX_PRIVATE_FILE_MODE = 0o600;

const CODEX_CONFIG = [
  'cli_auth_credentials_store = "file"',
  "",
  "[analytics]",
  "enabled = false",
  "",
].join("\n");

const SAFE_CHILD_ENVIRONMENT_KEYS = [
  "PATH",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "PATHEXT",
] as const;

export interface BranchyCodexRuntime {
  rootPath: string;
  codexHome: string;
  processHome: string;
  workspacePath: string;
  configPath: string;
  xdgConfigHome: string;
  xdgCacheHome: string;
  xdgDataHome: string;
  xdgStateHome: string;
}

async function ensurePrivateDirectory(path: string): Promise<void> {
  await mkdir(path, {
    recursive: true,
    mode: CODEX_DIRECTORY_MODE,
  });
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error(`Refusing unsafe Codex runtime directory: ${path}`);
  }
  await chmod(path, CODEX_DIRECTORY_MODE);
}

async function writePrivateConfig(path: string): Promise<void> {
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new Error(`Refusing unsafe Codex config file: ${path}`);
    }
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ENOENT"
    ) {
      throw error;
    }
  }

  const handle = await open(
    path,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_TRUNC |
      constants.O_NOFOLLOW,
    CODEX_PRIVATE_FILE_MODE,
  );
  try {
    await handle.writeFile(CODEX_CONFIG, "utf8");
    await handle.chmod(CODEX_PRIVATE_FILE_MODE);
  } finally {
    await handle.close();
  }
}

async function hardenPrivateFileIfPresent(path: string): Promise<void> {
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new Error(`Refusing unsafe Codex private file: ${path}`);
    }
    await chmod(path, CODEX_PRIVATE_FILE_MODE);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return;
    }
    throw error;
  }
}

export async function prepareBranchyCodexRuntime(
  userDataPath: string,
): Promise<BranchyCodexRuntime> {
  if (!isAbsolute(userDataPath)) {
    throw new Error("Branchy Chat user data path must be absolute");
  }

  const rootPath = join(userDataPath, "codex-runtime");
  const codexHome = join(rootPath, "codex-home");
  const processHome = join(rootPath, "process-home");
  const workspacePath = join(rootPath, "chat-workspace");
  const xdgConfigHome = join(processHome, ".config");
  const xdgCacheHome = join(processHome, ".cache");
  const xdgDataHome = join(processHome, ".local", "share");
  const xdgStateHome = join(processHome, ".local", "state");
  const configPath = join(codexHome, "config.toml");

  for (const path of [
    rootPath,
    codexHome,
    processHome,
    workspacePath,
    xdgConfigHome,
    xdgCacheHome,
    xdgDataHome,
    xdgStateHome,
  ]) {
    await ensurePrivateDirectory(path);
  }
  await writePrivateConfig(configPath);

  return {
    rootPath,
    codexHome,
    processHome,
    workspacePath,
    configPath,
    xdgConfigHome,
    xdgCacheHome,
    xdgDataHome,
    xdgStateHome,
  };
}

export async function hardenBranchyCodexRuntime(
  runtime: BranchyCodexRuntime,
): Promise<void> {
  for (const path of [
    runtime.rootPath,
    runtime.codexHome,
    runtime.processHome,
    runtime.workspacePath,
    runtime.xdgConfigHome,
    runtime.xdgCacheHome,
    runtime.xdgDataHome,
    runtime.xdgStateHome,
  ]) {
    await ensurePrivateDirectory(path);
  }
  await hardenPrivateFileIfPresent(runtime.configPath);
  await hardenPrivateFileIfPresent(join(runtime.codexHome, "auth.json"));
}

export function buildCodexChildEnvironment(
  runtime: BranchyCodexRuntime,
  sourceEnvironment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of SAFE_CHILD_ENVIRONMENT_KEYS) {
    const value = sourceEnvironment[key];
    if (typeof value === "string" && value.length > 0) {
      environment[key] = value;
    }
  }

  environment.CODEX_HOME = runtime.codexHome;
  environment.HOME = runtime.processHome;
  environment.XDG_CONFIG_HOME = runtime.xdgConfigHome;
  environment.XDG_CACHE_HOME = runtime.xdgCacheHome;
  environment.XDG_DATA_HOME = runtime.xdgDataHome;
  environment.XDG_STATE_HOME = runtime.xdgStateHome;
  return environment;
}

export type CodexExecutableKind = "dedicated-app-server" | "codex-cli";

export function buildCodexAppServerArguments(
  executableKind: CodexExecutableKind = "dedicated-app-server",
): string[] {
  const arguments_: string[] = [
    "--strict-config",
    "-c",
    'cli_auth_credentials_store="file"',
    "-c",
    'realtime.version="v2"',
    "-c",
    'realtime.transport="websocket"',
    "-c",
    "features.realtime_conversation=true",
    "-c",
    "features.shell_tool=false",
    "--listen",
    "stdio://",
  ];
  return executableKind === "codex-cli"
    ? ["app-server", ...arguments_]
    : arguments_;
}

export interface ResolveCodexExecutableOptions {
  isPackaged: boolean;
  resourcesPath?: string;
  bundledExecutablePath?: string;
  developmentExecutablePath?: string;
  pathExists?: (path: string) => boolean;
}

function isUsableExecutablePath(
  path: string,
  pathExists: (candidate: string) => boolean,
  allowSymbolicLink: boolean,
): boolean {
  if (!isAbsolute(path) || !pathExists(path)) {
    return false;
  }
  try {
    const metadata = lstatSync(path);
    if (metadata.isSymbolicLink()) {
      return allowSymbolicLink && statSync(path).isFile();
    }
    return metadata.isFile();
  } catch {
    return false;
  }
}

export function resolveCodexExecutable({
  isPackaged,
  resourcesPath,
  bundledExecutablePath,
  developmentExecutablePath,
  pathExists = existsSync,
}: ResolveCodexExecutableOptions): string {
  if (isPackaged) {
    const candidates = [
      bundledExecutablePath,
      resourcesPath
        ? join(
            resourcesPath,
            "codex",
            "bin",
            "codex-app-server",
          )
        : undefined,
    ].filter((value): value is string => Boolean(value));
    const executable = candidates.find((candidate) =>
      isUsableExecutablePath(candidate, pathExists, false),
    );
    if (!executable) {
      throw new Error(
        "The packaged Branchy Chat Codex app-server binary is missing",
      );
    }
    return executable;
  }

  if (developmentExecutablePath) {
    if (
      isAbsolute(developmentExecutablePath) &&
      !isUsableExecutablePath(developmentExecutablePath, pathExists, true)
    ) {
      throw new Error(
        `The configured development Codex binary is unavailable: ${developmentExecutablePath}`,
      );
    }
    return developmentExecutablePath;
  }

  for (const candidate of [
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex",
  ]) {
    if (isUsableExecutablePath(candidate, pathExists, true)) {
      return candidate;
    }
  }
  return "codex";
}

export function codexExecutableKind(
  executablePath: string,
  isPackaged: boolean,
): CodexExecutableKind {
  if (
    isPackaged ||
    basename(executablePath).startsWith("codex-app-server")
  ) {
    return "dedicated-app-server";
  }
  return "codex-cli";
}
