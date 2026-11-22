import type { NextConfig } from "next";

const desktop = process.env.STORYLOOM_DESKTOP === "1";

const nextConfig: NextConfig = {
  // Desktop installer builds a Node standalone server Electron can spawn.
  ...(desktop ? { output: "standalone" as const } : {}),
  // A second dev server can set this so it does not share the working .next lock.
  distDir: process.env.WORDLY_DIST_DIR || ".next",
  // PDFKit reads its font metric files from its own folder at run time.
  serverExternalPackages: ["better-sqlite3", "@prisma/adapter-better-sqlite3", "pdfkit"],
  experimental: {
    // Keep "security" only while an intentional Next.js upgrade agent run is active;
    // otherwise `next dev` exits under Cursor with the upgrade nudge.
    agentUpgrade: false,
    serverActions: {
      // Batches of reference files, change packages and backups exceed the 1 MB default.
      bodySizeLimit: "50mb",
    },
  },
};

export default nextConfig;
