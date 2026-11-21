import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { WorldSurfaceNav } from "@/components/world/WorldSurfaceNav";
import { getDb } from "@/server/db";
import { loadWorldCalendar } from "@/server/services/worldCalendarService";
import { SHELL, WORLD } from "@/ui/labels";
import { WorldCalendarForm } from "./WorldCalendarForm";

export const dynamic = "force-dynamic";

export default async function WorldCalendarPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const calendar = await loadWorldCalendar(getDb(), projectId);
  const base = `/projects/${encodeURIComponent(projectId)}`;
  return (
    <>
      <Breadcrumbs
        label={WORLD.breadcrumb}
        items={[
          { href: `${base}/world`, label: SHELL.world },
          { label: WORLD.worldCalendar, current: true },
        ]}
      />
      <PageHeader title={WORLD.worldCalendar} lead={WORLD.worldCalendarLead} />
      <WorldSurfaceNav projectId={projectId} current="calendar" />
      <WorldCalendarForm projectId={projectId} calendar={calendar} />
    </>
  );
}