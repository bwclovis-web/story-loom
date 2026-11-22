import { DevelopmentCues } from "@/components/world/CharacterDevelopment";
import { WorldToolHeader } from "@/components/world/WorldToolHeader";
import { developmentCuesForEvents } from "@/server/services/characterDevelopmentService";
import { CHARACTER_DEVELOPMENT } from "@/ui/labels";
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
  const db = getDb();
  const timeline = await loadStoryTimeline(db, projectId, { draft: query.draft, eventId: query.event ?? null });
  const arcCues = await developmentCuesForEvents(db, projectId, timeline.events.map((event) => event.id));
  return (
    <>
      <WorldToolHeader
        projectId={projectId}
        items={worldSurfaceCrumbs(projectId, "events")}
        title={WORLD.storyTimeline}
        lead={WORLD.storyTimelineLead}
      />
      {arcCues.length ? <DevelopmentCues title={CHARACTER_DEVELOPMENT.timelineCues} cues={arcCues} /> : null}
      <EventTimeline projectId={projectId} timeline={timeline} />
    </>
  );
}
