import { cookies } from "next/headers";
import { HelpHint } from "@/components/HelpHint";
import { ProjectOnboarding } from "@/components/shell/ProjectOnboarding";
import { MAPS_VIEW_COOKIE, parseMapsViewPreference } from "@/components/shell/preferences";
import { WorldToolHeader } from "@/components/world/WorldToolHeader";
import { getDb } from "@/server/db";
import { listRecordImages, recordImagePublicPath } from "@/server/services/imageService";
import { listAvailableReferences } from "@/server/services/seriesBibleService";
import { listWorldMaps } from "@/server/services/worldMapService";
import { SERIES, WORLD } from "@/ui/labels";
import { seriesBookLabel } from "@/world/seriesHome";
import { worldSurfaceCrumbs } from "@/ui/worldDestinations";
import type { MapLibraryItem } from "@/world/mapLibrary";
import { ClearMapTrail } from "./ClearMapTrail";
import { MapsLanding } from "./MapsLanding";

export const dynamic = "force-dynamic";

export default async function WorldMapsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const db = getDb();
  const cookieStore = await cookies();
  const initialView = parseMapsViewPreference(cookieStore.get(MAPS_VIEW_COOKIE)?.value);
  const mapsRaw = await listWorldMaps(db, projectId).catch(() => []);
  const maps: MapLibraryItem[] = mapsRaw.map((m) => ({
    id: m.id,
    title: m.title,
    imageId: m.imageId,
    imageName: m.imageName,
    hostRecordId: m.hostRecordId,
    hostRecordTitle: m.hostRecordTitle,
    classification: m.classification,
    pinCount: m.pinCount,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  }));
  const available = await listAvailableReferences(db, projectId, { linkableOnly: true });
  const images: Array<{ id: string; label: string; previewUrl: string }> = [];
  for (const entry of available) {
    const homeProjectId = entry.home?.projectId ?? projectId;
    const imgs = await listRecordImages(db, homeProjectId, entry.record.id);
    const homeSuffix = entry.home ? ` (${SERIES.homeBadge(seriesBookLabel(entry.home))})` : "";
    for (const img of imgs ?? []) {
      images.push({
        id: img.id,
        label: `${entry.record.title} — ${img.name}${homeSuffix}`,
        previewUrl: recordImagePublicPath(projectId, img.id),
      });
    }
  }

  return (
    <>
      <WorldToolHeader
        projectId={projectId}
        items={worldSurfaceCrumbs(projectId, "maps")}
        title={WORLD.maps}
        gettingStarted={<ProjectOnboarding projectId={projectId} quiet marked />}
        help={
          <HelpHint anchor="world-maps" topic="World maps">
            Upload a backdrop or choose an existing image. An upload can stay on a reference you already have, or on a
            new reference you name here. Markers can open a reference, another map, or both. Browse pans the map; Edit
            moves markers.
          </HelpHint>
        }
      />
      <ClearMapTrail projectId={projectId} />
      <MapsLanding
        projectId={projectId}
        maps={maps}
        images={images}
        hosts={available
          .filter((entry) => !entry.isShared)
          .map((entry) => ({
            id: entry.record.id,
            title: entry.record.title,
            isProtected: entry.record.protected,
          }))}
        initialView={initialView}
      />
    </>
  );
}
