"use strict";

const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const path = require("node:path");

/**
 * Desktop preferences under Electron userData.
 * { libraryDir, backupMirrorDir, openaiModel, onboardingComplete }
 * API key is stored separately via safeStorage when available.
 */

function configPath(userData) {
  return path.join(userData, "desktop-config.json");
}

function secretsPath(userData) {
  return path.join(userData, "assistant-key.bin");
}

function loadConfig(userData) {
  const file = configPath(userData);
  if (!existsSync(file)) {
    return {
      libraryDir: null,
      backupMirrorDir: null,
      openaiModel: null,
      onboardingComplete: false,
    };
  }
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return {
      libraryDir: typeof parsed.libraryDir === "string" ? parsed.libraryDir : null,
      backupMirrorDir: typeof parsed.backupMirrorDir === "string" ? parsed.backupMirrorDir : null,
      openaiModel: typeof parsed.openaiModel === "string" ? parsed.openaiModel : null,
      onboardingComplete: parsed.onboardingComplete === true,
    };
  } catch {
    return {
      libraryDir: null,
      backupMirrorDir: null,
      openaiModel: null,
      onboardingComplete: false,
    };
  }
}

function saveConfig(userData, next) {
  mkdirSync(userData, { recursive: true });
  writeFileSync(configPath(userData), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

function readEncryptedKey(userData, safeStorage) {
  const file = secretsPath(userData);
  if (!existsSync(file) || !safeStorage.isEncryptionAvailable()) return null;
  try {
    const buf = readFileSync(file);
    return safeStorage.decryptString(buf);
  } catch {
    return null;
  }
}

function writeEncryptedKey(userData, safeStorage, apiKey) {
  mkdirSync(userData, { recursive: true });
  const file = secretsPath(userData);
  if (!apiKey) {
    try {
      require("node:fs").unlinkSync(file);
    } catch {
      // ignore
    }
    return;
  }
  if (!safeStorage.isEncryptionAvailable()) {
    // Fallback plaintext only inside userData (not the repo). Prefer encryption.
    writeFileSync(path.join(userData, "assistant-key.txt"), apiKey, "utf8");
    return;
  }
  writeFileSync(file, safeStorage.encryptString(apiKey));
  try {
    require("node:fs").unlinkSync(path.join(userData, "assistant-key.txt"));
  } catch {
    // ignore
  }
}

function readFallbackKey(userData) {
  const file = path.join(userData, "assistant-key.txt");
  if (!existsSync(file)) return null;
  try {
    const text = readFileSync(file, "utf8").trim();
    return text || null;
  } catch {
    return null;
  }
}

module.exports = {
  configPath,
  loadConfig,
  saveConfig,
  readEncryptedKey,
  writeEncryptedKey,
  readFallbackKey,
};
