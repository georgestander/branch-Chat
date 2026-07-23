import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  protocol,
  session,
  shell,
  utilityProcess,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from "electron";

import {
  DEFAULT_BRANCHY_ARCHIVE_LIMITS,
} from "./archive/index.ts";
import { AssetStore } from "./assets/index.ts";
import {
  BranchyApplication,
  type BranchyGeneratedImageFile,
} from "./application/service.ts";
import { StreamHub } from "./application/stream-hub.ts";
import {
  createCodexUtilityGateway,
  type CodexUtilityProcess,
} from "./codex/utility-gateway.ts";
import {
  createQuitCoordinator,
  shouldReportRendererLoadFailure,
} from "./lifecycle.ts";
import { ConversationRepository } from "./persistence/index.ts";
import {
  appProtocol,
  isAllowedExternalUrl,
  isTrustedRendererUrl,
  resolveRendererAsset,
} from "./security.ts";
import {
  IPC_CHANNELS,
  type DesktopCommandRequestMap,
  type DesktopCommandResponseMap,
} from "../shared/contracts.ts";
import { IPC_PAYLOAD_VALIDATORS } from "../shared/validators.ts";

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string | undefined;

const assetProtocol = "branchy-asset";
const utilityEnvironmentKeys = [
  "PATH",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "PATHEXT",
] as const;

let application: BranchyApplication | null = null;
let streamHub: StreamHub | null = null;
let developmentServerUrl: string | undefined;

protocol.registerSchemesAsPrivileged([
  {
    scheme: appProtocol,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
  {
    scheme: assetProtocol,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);

function trustedRenderer(url: string): boolean {
  return isTrustedRendererUrl(url, developmentServerUrl);
}

function requireTrustedInvoke(event: IpcMainInvokeEvent): void {
  if (!trustedRenderer(event.senderFrame?.url ?? "")) {
    throw new Error("Untrusted renderer");
  }
}

function requireTrustedEvent(event: IpcMainEvent): void {
  if (!trustedRenderer(event.senderFrame?.url ?? "")) {
    throw new Error("Untrusted renderer");
  }
}

function requireApplication(
  options: { allowDuringShutdown?: boolean } = {},
): BranchyApplication {
  if (
    quitCoordinator.isShuttingDown() &&
    options.allowDuringShutdown !== true
  ) {
    throw new Error("Branchy Chat is closing.");
  }
  if (!application) {
    throw new Error("Branchy Chat is still starting.");
  }
  return application;
}

function codexUtilityEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of utilityEnvironmentKeys) {
    const value = source[key];
    if (typeof value === "string" && value.length > 0) {
      environment[key] = value;
    }
  }
  return environment;
}

function registerRendererProtocol(rendererRoot: string): void {
  protocol.handle(appProtocol, async (request) => {
    const url = new URL(request.url);
    if (url.hostname !== "renderer") {
      return new Response("Not found", { status: 404 });
    }
    const filePath = resolveRendererAsset(rendererRoot, url.pathname);
    if (!filePath) {
      return new Response("Not found", { status: 404 });
    }
    return net.fetch(pathToFileURL(filePath).toString());
  });
}

function registerAssetProtocol(assets: AssetStore): void {
  protocol.handle(assetProtocol, async (request) => {
    try {
      const url = new URL(request.url);
      const assetId = url.pathname.slice(1);
      if (
        url.hostname !== "asset" ||
        !assetId ||
        assetId.includes("/") ||
        url.search ||
        url.hash
      ) {
        return new Response("Not found", { status: 404 });
      }
      const resolved = await assets.resolveAssetFile(assetId);
      return new Response(await readFile(resolved.absolutePath), {
        headers: {
          "Cache-Control": "private, max-age=31536000, immutable",
          "Content-Security-Policy": "default-src 'none'",
          "Content-Type": resolved.asset.mimeType,
          "Cross-Origin-Resource-Policy": "cross-origin",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}

function configureSession(): void {
  session.defaultSession.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      const requestingUrl = details.requestingUrl ?? webContents.getURL();
      const mediaTypes =
        permission === "media" && "mediaTypes" in details
          ? (details.mediaTypes ?? [])
          : [];
      callback(
        permission === "media" &&
          mediaTypes.includes("audio") &&
          !mediaTypes.includes("video") &&
          trustedRenderer(requestingUrl),
      );
    },
  );

  const connectSource = developmentServerUrl
    ? ` 'self' ${new URL(developmentServerUrl).origin} ws://127.0.0.1:*`
    : " 'self'";
  const policy = [
    "default-src 'self'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    `img-src 'self' data: ${assetProtocol}:`,
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self'",
    `connect-src${connectSource}`,
  ].join("; ");

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [policy],
        "Cross-Origin-Resource-Policy": [
          details.url.startsWith(`${assetProtocol}://`)
            ? "cross-origin"
            : "same-origin",
        ],
        "Referrer-Policy": ["no-referrer"],
        "X-Content-Type-Options": ["nosniff"],
      },
    });
  });
}

function createWindow(): BrowserWindow | null {
  if (quitCoordinator.isShuttingDown()) {
    return null;
  }
  const preloadPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "preload.cjs",
  );
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 980,
    minHeight: 680,
    title: "Branchy Chat",
    backgroundColor: "#0b1020",
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      devTools: !app.isPackaged,
    },
  });

  window.once("ready-to-show", () => {
    if (quitCoordinator.isShuttingDown()) {
      return;
    }
    window.show();
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (!trustedRenderer(url)) {
      event.preventDefault();
    }
  });
  const rendererUrl =
    developmentServerUrl ?? `${appProtocol}://renderer/index.html`;
  void window.loadURL(rendererUrl).catch((error: unknown) => {
    if (
      !shouldReportRendererLoadFailure(
        quitCoordinator.isShuttingDown(),
        window.isDestroyed(),
      )
    ) {
      return;
    }
    const detail =
      error instanceof Error ? error.message : "Unknown renderer load error";
    console.error("[TRACE] renderer load failed", detail);
    dialog.showErrorBox(
      "Branchy Chat could not open",
      `The desktop interface could not be loaded.\n\n${detail}`,
    );
  });
  return window;
}

function registerInvoke<
  Channel extends Exclude<
    keyof DesktopCommandRequestMap,
    typeof IPC_CHANNELS.streamOpen | typeof IPC_CHANNELS.streamClose
  >,
>(
  channel: Channel,
  handler: (
    input: DesktopCommandRequestMap[Channel],
  ) =>
    | DesktopCommandResponseMap[Channel]
    | Promise<DesktopCommandResponseMap[Channel]>,
): void {
  ipcMain.handle(channel, async (event, rawInput) => {
    requireTrustedInvoke(event);
    const validator = IPC_PAYLOAD_VALIDATORS[channel] as (
      value: unknown,
    ) => DesktopCommandRequestMap[Channel];
    return handler(validator(rawInput));
  });
}

async function saveGeneratedImage(
  image: BranchyGeneratedImageFile,
): Promise<{ saved: boolean; fileName: string | null }> {
  const selected = await dialog.showSaveDialog({
    title: "Save generated image",
    defaultPath: image.suggestedFileName,
    filters: [
      {
        name: "Image",
        extensions: [image.suggestedFileName.split(".").at(-1) ?? "png"],
      },
    ],
    properties: ["createDirectory", "showOverwriteConfirmation"],
  });
  if (selected.canceled || !selected.filePath) {
    return { saved: false, fileName: null };
  }
  await copyFile(image.absolutePath, selected.filePath);
  return {
    saved: true,
    fileName: selected.filePath.split("/").at(-1) ?? image.suggestedFileName,
  };
}

function registerIpc(): void {
  registerInvoke(IPC_CHANNELS.bootstrap, (input) =>
    requireApplication().bootstrap(input),
  );
  registerInvoke(IPC_CHANNELS.listConversations, (input) =>
    requireApplication().listConversations(input),
  );
  registerInvoke(IPC_CHANNELS.createConversation, (input) =>
    requireApplication().createConversation(input),
  );
  registerInvoke(IPC_CHANNELS.loadConversation, (input) =>
    requireApplication().loadConversation(input.conversationId),
  );
  registerInvoke(IPC_CHANNELS.renameConversation, (input) =>
    requireApplication().renameConversation(input.conversationId, input.title),
  );
  registerInvoke(IPC_CHANNELS.deleteConversation, (input) =>
    requireApplication().deleteConversation(input.conversationId),
  );
  registerInvoke(IPC_CHANNELS.archiveConversation, (input) =>
    requireApplication().archiveConversation(input.conversationId),
  );
  registerInvoke(IPC_CHANNELS.unarchiveConversation, (input) =>
    requireApplication().unarchiveConversation(input.conversationId),
  );
  registerInvoke(IPC_CHANNELS.updateConversationSettings, (input) =>
    requireApplication().updateConversationSettings(input),
  );
  registerInvoke(IPC_CHANNELS.updateConversationCanvas, (input) =>
    requireApplication().updateConversationCanvas(input),
  );
  registerInvoke(IPC_CHANNELS.openCanvasBranchCard, (input) =>
    requireApplication().openBranchCard(
      input.conversationId,
      input.branchId,
    ),
  );
  registerInvoke(IPC_CHANNELS.loadCanvasBranchCard, (input) =>
    requireApplication().openBranchCard(
      input.conversationId,
      input.branchId,
    ),
  );
  registerInvoke(IPC_CHANNELS.renameBranch, (input) =>
    requireApplication().renameBranch(
      input.conversationId,
      input.branchId,
      input.title,
    ),
  );
  registerInvoke(IPC_CHANNELS.deleteBranch, (input) =>
    requireApplication().deleteBranch(
      input.conversationId,
      input.branchId,
    ),
  );
  registerInvoke(IPC_CHANNELS.saveBranchNote, (input) =>
    requireApplication().saveBranchNote(input),
  );
  registerInvoke(IPC_CHANNELS.saveComposerDraft, (input) =>
    requireApplication({ allowDuringShutdown: true }).saveComposerDraft(input),
  );
  registerInvoke(IPC_CHANNELS.sendMessage, (input) =>
    requireApplication().sendMessage(input),
  );
  registerInvoke(IPC_CHANNELS.cancelMessage, (input) =>
    requireApplication().cancelMessage(input.streamId),
  );
  registerInvoke(IPC_CHANNELS.getAttachmentConstraints, () =>
    requireApplication().attachmentConstraints(),
  );
  registerInvoke(IPC_CHANNELS.createAttachment, (input) =>
    requireApplication().createAttachment(input),
  );
  registerInvoke(IPC_CHANNELS.removeAttachment, (input) =>
    requireApplication().removeAttachment(
      input.conversationId,
      input.attachmentId,
    ),
  );
  registerInvoke(IPC_CHANNELS.transcribeAudio, (input) =>
    requireApplication().transcribeAudio(new Uint8Array(input.bytes)),
  );
  registerInvoke(IPC_CHANNELS.getGeneratedImageUrl, (input) =>
    requireApplication().generatedImageUrl(
      input.conversationId,
      input.messageId,
      input.imageId,
    ),
  );
  registerInvoke(IPC_CHANNELS.saveGeneratedImage, async (input) =>
    saveGeneratedImage(
      await requireApplication().generatedImageFile(
        input.conversationId,
        input.messageId,
        input.imageId,
        input.suggestedFileName,
      ),
    ),
  );
  registerInvoke(IPC_CHANNELS.retryGeneratedImage, (input) =>
    requireApplication().retryGeneratedImage(input),
  );
  registerInvoke(IPC_CHANNELS.getAccountState, () =>
    requireApplication().getAccountState(),
  );
  registerInvoke(IPC_CHANNELS.startChatGptLogin, () =>
    requireApplication().startChatGptLogin(),
  );
  registerInvoke(IPC_CHANNELS.cancelChatGptLogin, async (input) => {
    await requireApplication().cancelChatGptLogin(input.loginId);
  });
  registerInvoke(IPC_CHANNELS.logoutChatGpt, () =>
    requireApplication().logoutChatGpt(),
  );
  registerInvoke(IPC_CHANNELS.exportArchive, async (input) => {
    const destination = await dialog.showSaveDialog({
      title: "Export Branchy Chat archive",
      defaultPath: "Branchy Chat export.branchychat",
      filters: [{ name: "Branchy Chat archive", extensions: ["branchychat"] }],
      properties: ["createDirectory", "showOverwriteConfirmation"],
    });
    if (destination.canceled || !destination.filePath) {
      return {
        saved: false,
        fileName: null,
        conversationCount: 0,
      };
    }
    const archive = await requireApplication().exportArchive(
      input.conversationIds,
    );
    await writeFile(destination.filePath, archive.bytes, { mode: 0o600 });
    return {
      saved: true,
      fileName: destination.filePath.split("/").at(-1) ?? null,
      conversationCount: archive.conversationCount,
    };
  });
  registerInvoke(IPC_CHANNELS.importArchive, async (input) => {
    const source = await dialog.showOpenDialog({
      title: "Import Branchy Chat archive",
      filters: [{ name: "Branchy Chat archive", extensions: ["branchychat"] }],
      properties: ["openFile"],
    });
    const filePath = source.filePaths[0];
    if (source.canceled || !filePath) {
      return {
        cancelled: true,
        importedConversationIds: [],
        skippedConversationIds: [],
      };
    }
    const metadata = await stat(filePath);
    if (
      !metadata.isFile() ||
      metadata.size <= 0 ||
      metadata.size > DEFAULT_BRANCHY_ARCHIVE_LIMITS.maxArchiveBytes
    ) {
      throw new Error("The selected Branchy Chat archive is not valid.");
    }
    return requireApplication().importArchive(
      await readFile(filePath),
      input.conflictPolicy,
    );
  });
  registerInvoke(IPC_CHANNELS.openExternal, async (input) => {
    if (!isAllowedExternalUrl(input.url)) {
      throw new Error("Branchy only opens HTTPS links.");
    }
    await shell.openExternal(input.url);
    return { opened: true };
  });

  ipcMain.on(IPC_CHANNELS.streamOpen, (event, rawInput) => {
    try {
      requireTrustedEvent(event);
      const input = IPC_PAYLOAD_VALIDATORS[IPC_CHANNELS.streamOpen](rawInput);
      const port = event.ports[0];
      if (!port || event.ports.length !== 1 || !streamHub) {
        throw new Error("A single stream port is required.");
      }
      streamHub.open(input.streamId, input.subscriptionId, port);
    } catch {
      for (const port of event.ports) {
        port.close();
      }
    }
  });
  ipcMain.on(IPC_CHANNELS.streamClose, (event, rawInput) => {
    try {
      requireTrustedEvent(event);
      const input = IPC_PAYLOAD_VALIDATORS[IPC_CHANNELS.streamClose](rawInput);
      streamHub?.close(input.streamId, input.subscriptionId);
    } catch {
      // A stale or untrusted close request has no authority to mutate streams.
    }
  });
}

async function initializeApplication(): Promise<void> {
  const userDataPath = app.getPath("userData");
  await mkdir(userDataPath, { recursive: true, mode: 0o700 });
  const utilityEntryPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "utility-entry.cjs",
  );
  const codex = await createCodexUtilityGateway({
    initialize: {
      userDataPath,
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      ...(app.isPackaged
        ? {}
        : {
            developmentExecutablePath: resolve(
              app.getAppPath(),
              "resources/codex/bin/codex-app-server",
            ),
          }),
    },
    spawnProcess: () =>
      utilityProcess.fork(utilityEntryPath, [], {
        cwd: userDataPath,
        env: codexUtilityEnvironment(),
        serviceName: "Branchy Chat Codex",
        stdio: "ignore",
        allowLoadingUnsignedLibraries: false,
        disclaim: false,
      }) as CodexUtilityProcess,
    onDiagnostic: (message) => {
      console.warn(`[TRACE] codex ${message}`);
    },
  });
  const assets = await AssetStore.open({
    rootPath: join(userDataPath, "assets"),
    generatedImageSourceRoots: [
      join(userDataPath, "codex-runtime", "chat-workspace"),
      join(userDataPath, "codex-runtime", "codex-home"),
    ],
  });
  const repository = ConversationRepository.open(
    join(userDataPath, "branchy.sqlite3"),
  );
  streamHub = new StreamHub();
  application = new BranchyApplication({
    assets,
    codex,
    repository,
    publishStream: (streamId, event) => {
      streamHub?.publish(streamId, event);
    },
  });
  application.recoverInterruptedMessages();
  registerAssetProtocol(assets);
}

async function shutdown(): Promise<void> {
  streamHub?.dispose();
  streamHub = null;
  const activeApplication = application;
  if (activeApplication) {
    try {
      await activeApplication.close();
    } finally {
      if (application === activeApplication) {
        application = null;
      }
    }
  }
}

const quitCoordinator = createQuitCoordinator({
  shutdown,
  hideWindows: () => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.hide();
      }
    }
  },
  quit: () => app.quit(),
  exit: (exitCode) => app.exit(exitCode),
  onError: (error) => {
    console.error(
      "[TRACE] shutdown failed",
      error instanceof Error ? error.message : "unknown error",
    );
  },
});

app.setName("Branchy Chat");

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (quitCoordinator.isShuttingDown()) {
      return;
    }
    const window = BrowserWindow.getAllWindows()[0];
    if (window) {
      if (window.isMinimized()) {
        window.restore();
      }
      window.focus();
    }
  });

  app.whenReady().then(async () => {
    developmentServerUrl = MAIN_WINDOW_VITE_DEV_SERVER_URL;
    configureSession();
    await initializeApplication();
    registerIpc();

    if (!developmentServerUrl) {
      const rendererName = MAIN_WINDOW_VITE_NAME ?? "main_window";
      const rendererRoot = resolve(
        dirname(fileURLToPath(import.meta.url)),
        "../renderer",
        rendererName,
      );
      registerRendererProtocol(rendererRoot);
    }
    createWindow();

    app.on("activate", () => {
      if (
        !quitCoordinator.isShuttingDown() &&
        BrowserWindow.getAllWindows().length === 0
      ) {
        createWindow();
      }
    });
  }).catch((error: unknown) => {
    console.error(
      "[TRACE] startup failed",
      error instanceof Error ? error.message : "unknown error",
    );
    void dialog.showErrorBox(
      "Branchy Chat could not start",
      error instanceof Error
        ? error.message
        : "The local application could not be initialized.",
    );
    app.quit();
  });

  app.on("before-quit", (event) => {
    quitCoordinator.handleBeforeQuit(event);
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}
