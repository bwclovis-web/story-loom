/**
 * Desktop installer: Next standalone build, then electron-builder.
 * Usage: pnpm desktop:build
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = { ...process.env, STORYLOOM_DESKTOP: "1" };

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("pnpm", ["build"]);
run("pnpm", ["exec", "electron-builder"]);
