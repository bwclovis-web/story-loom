import type { Metadata } from "next";
import { cookies } from "next/headers";
import { AppShell } from "@/components/shell/AppShell";
import {
  LAYOUT_COOKIE,
  NAV_COOKIE,
  parseLayoutPreference,
  parseNavPreference,
  PROJECT_COOKIE,
} from "@/components/shell/preferences";
import { getDb } from "@/server/db";
import { listProjectSummaries } from "@/server/services/projectService";
import { listRecordNav } from "@/server/services/recordService";
import { parseTextAppearance, TEXT_COOKIE, textAppearanceVars } from "@/ui/textAppearance";
import { parseTheme, THEME_COOKIE } from "@/ui/theme";
import "./globals.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Wordly Editor",
  description: "Local project store for manuscript and reference records",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const db = getDb();
  const [projects, records] = await Promise.all([listProjectSummaries(db), listRecordNav(db)]);
  const lastProject = cookieStore.get(PROJECT_COOKIE)?.value;
  const theme = parseTheme(cookieStore.get(THEME_COOKIE)?.value);

  return (
    <html
      lang="en"
      data-theme={theme}
      style={textAppearanceVars(parseTextAppearance(cookieStore.get(TEXT_COOKIE)?.value)) as React.CSSProperties}
    >
      <body>
        <AppShell
          projects={projects}
          recordTypes={records.map((r) => [r.id, r.type])}
          initialNav={parseNavPreference(cookieStore.get(NAV_COOKIE)?.value)}
          initialProjectId={projects.some((p) => p.id === lastProject) ? lastProject! : null}
          initialLayout={parseLayoutPreference(cookieStore.get(LAYOUT_COOKIE)?.value)}
          initialTheme={theme}
        >
          {children}
        </AppShell>
      </body>
    </html>
  );
}
