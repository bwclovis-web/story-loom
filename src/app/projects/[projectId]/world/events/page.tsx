import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { PageHeader } from "@/components/ui/PageHeader";
import { WorldSurfaceNav } from "@/components/world/WorldSurfaceNav";
import { getDb } from "@/server/db";
import { loadStoryTimeline } from "@/server/services/storyEventService";
import { SHELL, WORLD } from "@/ui/labels";
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
  const base = `/projects/${encodeURIComponent(projectId)}`;
  return (
    <>
      <Breadcrumbs
        label={WORLD.breadcrumb}
        items={[
          { href: `${base}/world`, label: SHELL.world },
          { label: WORLD.storyTimeline, current: true },
        ]}
      />
      <PageHeader title={WORLD.storyTimeline} lead={WORLD.storyTimelineLead} />
      <WorldSurfaceNav projectId={projectId} current="events" />
      <EventTimeline projectId={projectId} timeline={timeline} />
    </>
  );
}
