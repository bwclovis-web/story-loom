# Story Loom desktop (Electron)

Local-only shell around the Next.js app. The database stays on this computer.

## Development

1. From the repo root, build once so `next start` can serve:

   ```bash
   pnpm build
   ```

2. Launch the desktop window (spawns `next start` on a free `127.0.0.1` port):

   ```bash
   pnpm desktop:dev
   ```

To attach the window to an already-running `pnpm dev` on port 2112:

```bash
STORYLOOM_USE_EXISTING_SERVER=1 STORYLOOM_SERVER_PORT=2112 pnpm desktop:dev
```

First launch asks for a **library folder**. That path is written to Electron `userData` and mirrored into `local/library.json` so the Next process opens `storyloom.db` there.

## API keys

Prefer **Settings** in the app (your own OpenAI key). The desktop shell keeps an OS-encrypted copy under Electron `userData` when `safeStorage` is available (fallback: a file only inside `userData`). On each launch it writes `local/desktop-assistant-bridge.json` and injects `WORDLY_OPENAI_API_KEY` for the local server. Precedence: **desktop encrypted > `local/assistant-secrets.json` > `.env` WORDLY_* only** (web Settings still use the JSON file when not on desktop).

## Rolling backups

When **rolling schedule** is enabled in `local/backup-mirror.json`, the shell calls `POST /api/desktop/rolling-backup` on launch, once per day, and on window close (mirror folder required). Retention pruning runs on the server after each rolling backup.

## Installer build

```bash
pnpm desktop:build
```

This sets `STORYLOOM_DESKTOP=1` for a Next standalone build, then runs `electron-builder`. Code signing and notarization are optional for private beta.
