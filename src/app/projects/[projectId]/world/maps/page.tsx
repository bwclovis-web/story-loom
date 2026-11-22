import Link from "next/link";
import { HelpHint } from "@/components/HelpHint";
import { ButtonLink } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ProjectOnboarding } from "@/components/shell/ProjectOnboarding";
import { WorldToolHeader } from "@/components/world/WorldToolHeader";
import { getDb } from "@/server/db";
import { listRecordImages } from "@/server/services/imageService";
import { listRecords } from "@/server/services/recordService";
import { listWorldMaps } from "@/server/services/worldMapService";
import { isLinkableReferenceType } from "@/domain/recordTypes";
import { isWorldType } from "@/ui/world";
import { WORLD } from "@/ui/labels";
import { worldSurfaceCrumbs } from "@/ui/worldDestinations";
import { ClearMapTrail } from "./ClearMapTrail";
import { CreateMapForm } from "./CreateMapForm";

export const dynamic = "force-dynamic";

export default async function WorldMapsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const db = getDb();
  const maps = await listWorldMaps(db, projectId).catch(() => []);
  const records = (await listRecords(db, projectId)).filter(
    (r) => isWorldType(r.type) || isLinkableReferenceType(r.type),
  );
  const images: Array<{ id: string; label: string }> = [];
  for (const r of records) {
    const imgs = await listRecordImages(db, projectId, r.id);
    for (const img of imgs ?? []) {
      images.push({ id: img.id, label: `${r.title} — ${img.name}` });
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

      <section className="panel" aria-labelledby="new-map-heading">
        <h2 id="new-map-heading">{WORLD.newMap}</h2>
        <CreateMapForm
          projectId={projectId}
          images={images}
          hosts={records.map((record) => ({ id: record.id, title: record.title, isProtected: record.protected }))}
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
