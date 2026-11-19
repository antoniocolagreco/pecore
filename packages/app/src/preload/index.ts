import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("pecore", {
  api: (): Promise<{ port: number; token: string }> => ipcRenderer.invoke("pecore:api"),
});
