import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
