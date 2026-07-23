import { contextBridge, ipcRenderer } from "electron";

type PingResponse = {
  ok: boolean;
  appName: string;
  electron: string;
  node: string;
  platform: string;
};

const api = {
  ping: (): Promise<PingResponse> => ipcRenderer.invoke("branchy:ping"),
};

contextBridge.exposeInMainWorld("branchy", api);
