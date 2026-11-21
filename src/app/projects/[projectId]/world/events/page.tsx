import { WorldToolHeader } from "@/components/world/WorldToolHeader";
import { getDb } from "@/server/db";
import { loadStoryTimeline } from "@/server/services/storyEventService";
import { WORLD } from "@/ui/labels";
import { worldSurfaceCrumbs } from "@/ui/worldDestinations";
import { EventTimeline } from "./EventTimeline";

export const dynamic = "force-dynamic";

export default async function StoryEventsPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ event?: string; draft?: string }>;
}) {
  const { projectId } = await params;
  const query = await searchParams;
  const timeline = await loadStoryTimeline(getDb(), projectId, { draft: query.draft, eventId: query.event ?? null });
  return (
    <>
      <WorldToolHeader
        projectId={projectId}
        items={worldSurfaceCrumbs(projectId, "events")}
        title={WORLD.storyTimeline}
        lead={WORLD.storyTimelineLead}
      />
      <EventTimeline projectId={projectId} timeline={timeline} />
    </>
  );
}
