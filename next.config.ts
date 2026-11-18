import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PDFKit reads its font metric files from its own folder at run time.
  serverExternalPackages: ["better-sqlite3", "@prisma/adapter-better-sqlite3", "pdfkit"],
  experimental: {
    // Marks this checkout as the Next.js security upgrade agent run.
    agentUpgrade: "security",
    serverActions: {
      // Batches of reference files, change packages and backups exceed the 1 MB default.
      bodySizeLimit: "50mb",
    },
  },
};

export default nextConfig;
