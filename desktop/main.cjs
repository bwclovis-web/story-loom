"use strict";

/**
 * Story Loom desktop shell. Spawns the local Next.js server on 127.0.0.1
 * (free port), injects library / backup / API key env, and opens a window.
 *
 * Dev:  pnpm desktop:dev  (expects repo root; can use next start or an already-running server)
 * Prod: electron-builder packs this with the standalone Next output.
 */

const { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } = require("electron");
const { spawn } = require("node:child_process");
const { createServer } = require("node:net");
const path = require("node:path");
const { existsSync, mkdirSync, writeFileSync } = require("node:fs");
const { loadConfig, saveConfig, readEncryptedKey, writeEncryptedKey, readFallbackKey } = require("./config.cjs");

const isDev = !app.isPackaged;
let mainWindow = null;
let serverProcess = null;
let serverPort = null;

function appRoot() {
  if (isDev) return path.resolve(__dirname, "..");
  return process.resourcesPath;
}

function userData() {
  return app.getPath("userData");
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
    server.on("error", reject);
  });
}

function waitForServer(port, timeoutMs = 120_000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      fetch(`http://127.0.0.1:${port}/`)
        .then(() => resolve())
        .catch(() => {
          if (Date.now() - started > timeoutMs) reject(new Error("Server did not become ready in time."));
          else setTimeout(tryOnce, 400);
        });
    };
    tryOnce();
  });
}

async function ensureOnboarding(config) {
  if (config.onboardingComplete && config.libraryDir && existsSync(config.libraryDir)) {
    return config;
  }
  const result = await dialog.showMessageBox({
    type: "question",
    buttons: ["Choose library folder", "Use default (app data)", "Quit"],
    defaultId: 0,
    cancelId: 2,
    title: "Welcome to Story Loom",
    message: "Where should Story Loom keep your novels?",
    detail:
      "Choose a folder you control (for example Documents\\StoryLoom). The database file storyloom.db will live there. You can change this later in Settings.",
  });
  if (result.response === 2) {
    app.quit();
    return config;
  }
  let libraryDir = path.join(userData(), "library");
  if (result.response === 0) {
    const picked = await dialog.showOpenDialog({
      title: "Choose Story Loom library folder",
      properties: ["openDirectory", "createDirectory"],
    });
    if (picked.canceled || !picked.filePaths[0]) {
      app.quit();
      return config;
    }
    libraryDir = picked.filePaths[0];
  }
  mkdirSync(libraryDir, { recursive: true });
  const next = {
    ...config,
    libraryDir,
    onboardingComplete: true,
  };
  return saveConfig(userData(), next);
}

function writeDevLibraryBridge(config) {
  // So the Next process (cwd = repo) resolves the same library folder.
  const localDir = path.join(appRoot(), "local");
  mkdirSync(localDir, { recursive: true });
  writeFileSync(
    path.join(localDir, "library.json"),
    `${JSON.stringify({ libraryDir: config.libraryDir }, null, 2)}\n`,
    "utf8",
  );
  if (config.backupMirrorDir) {
    writeFileSync(
      path.join(localDir, "backup-mirror.json"),
      `${JSON.stringify({ mirrorDir: config.backupMirrorDir }, null, 2)}\n`,
      "utf8",
    );
  }
}

function buildChildEnv(config, port) {
  const env = {
    ...process.env,
    STORYLOOM_ELECTRON: "1",
    STORYLOOM_DESKTOP: isDev ? process.env.STORYLOOM_DESKTOP || "" : "1",
    PORT: String(port),
    HOSTNAME: "127.0.0.1",
    WORDLY_LIBRARY_DIR: config.libraryDir || "",
  };
  if (config.backupMirrorDir) env.WORDLY_BACKUP_MIRROR_DIR = config.backupMirrorDir;
  if (config.openaiModel) env.OPENAI_MODEL = config.openaiModel;

  const key = readEncryptedKey(userData(), safeStorage) || readFallbackKey(userData());
  if (key) env.WORDLY_OPENAI_API_KEY = key;

  // Prefer library DB over any developer DATABASE_URL.
  if (config.libraryDir) {
    const db = path.join(config.libraryDir, "storyloom.db");
    env.DATABASE_URL = `file:${db.replace(/\\/g, "/")}`;
  }
  return env;
}

async function startServer(config) {
  serverPort = await freePort();
  const env = buildChildEnv(config, serverPort);
  writeDevLibraryBridge(config);

  const root = appRoot();
  const useExisting = process.env.STORYLOOM_USE_EXISTING_SERVER === "1";
  if (useExisting) {
    serverPort = Number(process.env.STORYLOOM_SERVER_PORT || 2112);
    return serverPort;
  }

  if (isDev) {
    // Prefer an already-running pnpm dev on 2112 when asked; otherwise start next.
    const startCmd = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
    serverProcess = spawn(startCmd, ["exec", "next", "start", "-H", "127.0.0.1", "-p", String(serverPort)], {
      cwd: root,
      env,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
  } else {
    const standalone = path.join(root, "standalone", "server.js");
    const entry = existsSync(standalone) ? standalone : path.join(root, "server.js");
    serverProcess = spawn(process.execPath, [entry], {
      cwd: path.dirname(entry),
      env: { ...env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: "inherit",
    });
  }

  serverProcess.on("exit", (code) => {
    serverProcess = null;
    if (code && code !== 0) {
      dialog.showErrorBox("Story Loom", `The local server exited (code ${code}).`);
    }
  });

  await waitForServer(serverPort);
  return serverPort;
}

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    title: "Story Loom",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.loadURL(`http://127.0.0.1:${port}/`);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function stopServer() {
  if (!serverProcess) return;
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(serverProcess.pid), "/f", "/t"]);
    } else {
      serverProcess.kill("SIGTERM");
    }
  } catch {
    // ignore
  }
  serverProcess = null;
}

ipcMain.handle("desktop:pick-library", async () => {
  const picked = await dialog.showOpenDialog({
    title: "Choose Story Loom library folder",
    properties: ["openDirectory", "createDirectory"],
  });
  if (picked.canceled || !picked.filePaths[0]) return null;
  const config = loadConfig(userData());
  const next = saveConfig(userData(), { ...config, libraryDir: picked.filePaths[0], onboardingComplete: true });
  writeDevLibraryBridge(next);
  return picked.filePaths[0];
});

ipcMain.handle("desktop:pick-mirror", async () => {
  const picked = await dialog.showOpenDialog({
    title: "Choose backup mirror folder",
    properties: ["openDirectory", "createDirectory"],
  });
  if (picked.canceled || !picked.filePaths[0]) return null;
  const config = loadConfig(userData());
  saveConfig(userData(), { ...config, backupMirrorDir: picked.filePaths[0] });
  return picked.filePaths[0];
});

ipcMain.handle("desktop:info", async () => {
  const config = loadConfig(userData());
  return {
    libraryDir: config.libraryDir,
    backupMirrorDir: config.backupMirrorDir,
    hasEncryptedKey: Boolean(readEncryptedKey(userData(), safeStorage) || readFallbackKey(userData())),
    userData: userData(),
  };
});

ipcMain.handle("desktop:save-key", async (_event, payload) => {
  const apiKey = typeof payload?.apiKey === "string" ? payload.apiKey.trim() : "";
  const model = typeof payload?.model === "string" ? payload.model.trim() : "";
  const config = loadConfig(userData());
  if (model) saveConfig(userData(), { ...config, openaiModel: model });
  if (payload?.clear) writeEncryptedKey(userData(), safeStorage, null);
  else if (apiKey) writeEncryptedKey(userData(), safeStorage, apiKey);
  return { ok: true };
});

app.whenReady().then(async () => {
  try {
    let config = loadConfig(userData());
    config = await ensureOnboarding(config);
    if (!config.libraryDir) {
      app.quit();
      return;
    }
    const port = await startServer(config);
    createWindow(port);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    dialog.showErrorBox("Story Loom failed to start", message);
    stopServer();
    app.quit();
  }
});

app.on("window-all-closed", () => {
  stopServer();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  stopServer();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0 && serverPort) createWindow(serverPort);
});
