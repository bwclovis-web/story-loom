"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("storyLoomDesktop", {
  isDesktop: true,
  pickLibraryFolder: () => ipcRenderer.invoke("desktop:pick-library"),
  pickBackupMirrorFolder: () => ipcRenderer.invoke("desktop:pick-mirror"),
  getDesktopInfo: () => ipcRenderer.invoke("desktop:info"),
});
