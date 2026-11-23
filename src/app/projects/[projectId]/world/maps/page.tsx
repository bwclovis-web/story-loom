import Link from "next/link";
import { HelpHint } from "@/components/HelpHint";
import { ButtonLink } from "@/components/ui/Atoms/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ProjectOnboarding } from "@/components/shell/ProjectOnboarding";
import { WorldToolHeader } from "@/components/world/WorldToolHeader";
import { getDb } from "@/server/db";
import { listRecordImages } from "@/server/services/imageService";
import { listAvailableReferences } from "@/server/services/seriesBibleService";
import { listWorldMaps } from "@/server/services/worldMapService";
import { SERIES, WORLD } from "@/ui/labels";
import { seriesBookLabel } from "@/world/seriesHome";
import { worldSurfaceCrumbs } from "@/ui/worldDestinations";
import { ClearMapTrail } from "./ClearMapTrail";
import { CreateMapForm } from "./CreateMapForm";

export const dynamic = "force-dynamic";

export default async function WorldMapsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const db = getDb();
  const maps = await listWorldMaps(db, projectId).catch(() => []);
  const available = await listAvailableReferences(db, projectId, { linkableOnly: true });
  const images: Array<{ id: string; label: string }> = [];
  for (const entry of available) {
    const homeProjectId = entry.home?.projectId ?? projectId;
    const imgs = await listRecordImages(db, homeProjectId, entry.record.id);
    const homeSuffix = entry.home ? ` (${SERIES.homeBadge(seriesBookLabel(entry.home))})` : "";
    for (const img of imgs ?? []) {
      images.push({ id: img.id, label: `${entry.record.title} — ${img.name}${homeSuffix}` });
    }
  }
  const base = `/projects/${encodeURIComponent(projectId)}`;

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

      <section className="panel world-create-panel" aria-labelledby="new-map-heading">
        <header className="world-create-intro">
          <h2 id="new-map-heading">{WORLD.newMap}</h2>
          <p className="small muted">{WORLD.newMapLead}</p>
        </header>
        <CreateMapForm
          projectId={projectId}
          images={images}
          hosts={available
            .filter((entry) => !entry.isShared)
            .map((entry) => ({
              id: entry.record.id,
              title: entry.record.title,
              isProtected: entry.record.protected,
            }))}
        />
      </section>

      <section className="panel" aria-labelledby="maps-list-heading">
        <h2 id="maps-list-heading">{WORLD.maps}</h2>
        {maps.length === 0 ? (
          <EmptyState>{WORLD.noMaps}</EmptyState>
        ) : (
          <ul className="stack">
            {maps.map((m) => (
              <li key={m.id} className="row" style={{ justifyContent: "space-between", gap: "1rem" }}>
                <div>
                  <Link href={`${base}/world/maps/${encodeURIComponent(m.id)}`}>{m.title}</Link>{" "}
                  <span className="small muted">
                    {m.imageName} · {WORLD.pinsCount(m.pinCount)} · on {m.hostRecordTitle}
                  </span>
                </div>
                <ButtonLink href={`${base}/world/maps/${encodeURIComponent(m.id)}`} variant="secondary" size="sm">
                  {WORLD.openMap}
                </ButtonLink>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
