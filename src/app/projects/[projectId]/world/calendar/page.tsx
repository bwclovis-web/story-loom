import { WorldToolHeader } from "@/components/world/WorldToolHeader";
import { getDb } from "@/server/db";
import { loadWorldCalendar } from "@/server/services/worldCalendarService";
import { WORLD } from "@/ui/labels";
import { worldSurfaceCrumbs } from "@/ui/worldDestinations";
import { WorldCalendarForm } from "./WorldCalendarForm";

export const dynamic = "force-dynamic";

export default async function WorldCalendarPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const calendar = await loadWorldCalendar(getDb(), projectId);
  return (
    <>
      <WorldToolHeader
        items={worldSurfaceCrumbs(projectId, "calendar")}
        title={WORLD.worldCalendar}
        lead={WORLD.worldCalendarLead}
      />
      <WorldCalendarForm projectId={projectId} calendar={calendar} />
    </>
  );
}