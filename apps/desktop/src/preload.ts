import { contextBridge, ipcRenderer } from "electron";

import { createBranchyDesktopApi } from "./preload-api.ts";

contextBridge.exposeInMainWorld(
  "branchy",
  createBranchyDesktopApi({
    invoke: (channel, payload) => ipcRenderer.invoke(channel, payload),
    postMessage: (channel, payload, transfer) =>
      ipcRenderer.postMessage(
        channel,
        payload,
        transfer ? [...transfer] : undefined,
      ),
    send: (channel, payload) => ipcRenderer.send(channel, payload),
  }),
);
