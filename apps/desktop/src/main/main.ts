import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";
import {
  app,
  BrowserWindow,
  ipcMain,
  net,
  protocol,
  session,
  shell,
} from "electron";

import {
  appProtocol,
  isAllowedExternalUrl,
  isTrustedRendererUrl,
  resolveRendererAsset,
} from "./security.ts";

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string | undefined;

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
]);

function registerProtocol(rendererRoot: string): void {
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

function configureSession(developmentServerUrl?: string): void {
  const trustedRenderer = (value: string) =>
    isTrustedRendererUrl(value, developmentServerUrl);

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
    "img-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self'",
    `connect-src${connectSource}`,
  ].join("; ");

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [policy],
        "X-Content-Type-Options": ["nosniff"],
      },
    });
  });
}

function createWindow(developmentServerUrl?: string): BrowserWindow {
  const preloadPath = join(dirname(fileURLToPath(import.meta.url)), "preload.js");
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    title: "Branchy Chat",
    backgroundColor: "#0b1020",
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

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (!isTrustedRendererUrl(url, developmentServerUrl)) {
      event.preventDefault();
    }
  });
  return window;
}

app.setName("Branchy Chat");

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.on("second-instance", () => {
  const window = BrowserWindow.getAllWindows()[0];
  if (window) {
    if (window.isMinimized()) window.restore();
    window.focus();
  }
});

app.whenReady().then(() => {
  const developmentServerUrl = MAIN_WINDOW_VITE_DEV_SERVER_URL;
  configureSession(developmentServerUrl);

  ipcMain.handle("branchy:ping", (event) => {
    if (
      !isTrustedRendererUrl(
        event.senderFrame?.url ?? "",
        developmentServerUrl,
      )
    ) {
      throw new Error("Untrusted renderer");
    }
    return {
      ok: true,
      appName: app.getName(),
      electron: process.versions.electron,
      node: process.versions.node,
      platform: process.platform,
    };
  });

  if (!MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    const rendererName = MAIN_WINDOW_VITE_NAME ?? "main_window";
    const rendererRoot = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../renderer",
      rendererName,
    );
    registerProtocol(rendererRoot);
  }

  const window = createWindow(developmentServerUrl);
  if (developmentServerUrl) {
    void window.loadURL(developmentServerUrl);
  } else {
    void window.loadURL(`${appProtocol}://renderer/index.html`);
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
