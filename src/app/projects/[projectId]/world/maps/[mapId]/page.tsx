import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/server/db";
import { NotFoundError } from "@/server/services/errors";
import { listRecords } from "@/server/services/recordService";
import { getWorldMap } from "@/server/services/worldMapService";
import { isLinkableReferenceType, RECORD_TYPE_LABELS } from "@/domain/recordTypes";
import { isWorldType } from "@/ui/world";
import { SHELL, WORLD } from "@/ui/labels";
import { MapCanvas } from "../MapCanvas";

export const dynamic = "force-dynamic";

export default async function WorldMapPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string; mapId: string }>;
  searchParams: Promise<{ pin?: string }>;
}) {
  const { projectId, mapId } = await params;
  const query = await searchParams;
  const db = getDb();
  let map;
  try {
    map = await getWorldMap(db, projectId, mapId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const records = (await listRecords(db, projectId)).filter(
    (r) => isWorldType(r.type) || isLinkableReferenceType(r.type),
  );
  const base = `/projects/${encodeURIComponent(projectId)}`;

  return (
    <>
      <nav aria-label={WORLD.breadcrumb} className="breadcrumbs">
        <ol>
          <li>
            <Link href={`${base}/world`}>{SHELL.world}</Link>
          </li>
          <li>
            <Link href={`${base}/world/maps`}>{WORLD.maps}</Link>
          </li>
          <li>
            <span aria-current="page">{map.title}</span>
          </li>
        </ol>
      </nav>
      <MapCanvas
        projectId={projectId}
        map={map}
        records={records.map((r) => ({
          id: r.id,
          title: r.title,
          typeLabel: RECORD_TYPE_LABELS[r.type],
        }))}
        initialPinId={query.pin ?? null}
      />
    </>
  );
}
