const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("meshnet", {
  list: () => ipcRenderer.invoke("chats:list"),
  create: () => ipcRenderer.invoke("chats:create"),
});
