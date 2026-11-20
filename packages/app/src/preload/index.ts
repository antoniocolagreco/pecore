import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("pecore", {
  api: (): Promise<{ port: number; token: string }> => ipcRenderer.invoke("pecore:api"),
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke("pecore:pick-folder"),
  pickFile: (defaultPath: string | null): Promise<string | null> => ipcRenderer.invoke("pecore:pick-file", defaultPath),
});
