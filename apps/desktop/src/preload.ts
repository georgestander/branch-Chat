import { contextBridge, ipcRenderer } from "electron";

import { createBranchyDesktopApi } from "./preload-api.ts";

contextBridge.exposeInMainWorld(
  "branchy",
  createBranchyDesktopApi({
    invoke: (channel, payload) => ipcRenderer.invoke(channel, payload),
    on: (channel, listener) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => {
        listener(payload);
      };
      ipcRenderer.on(channel, handler);
      return () => ipcRenderer.removeListener(channel, handler);
    },
    postMessage: (channel, payload, transfer) =>
      ipcRenderer.postMessage(
        channel,
        payload,
        transfer ? [...transfer] : undefined,
      ),
    send: (channel, payload) => ipcRenderer.send(channel, payload),
  }),
);
