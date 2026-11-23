import { ProjectPageHeader } from "@/components/library/ProjectPageHeader";
import { DraftScopeChip, VisitDraftSwitcher, type DraftOption } from "@/components/drafts/DraftControls";
import { HelpHint } from "@/components/HelpHint";
import { Banner } from "@/components/ui/Banner";
import { isManuscriptType, isRecordType, RECORD_TYPE_LABELS, type RecordType } from "@/domain/recordTypes";
import { getDb } from "@/server/db";
import { resolveExportDraftId } from "@/server/draftSelection";
import { getDraftDefaults, listManuscriptDrafts } from "@/server/services/draftService";
import { EXPORT } from "@/ui/labels";
import { listRecords } from "@/server/services/recordService";
import { listAvailableReferences } from "@/server/services/seriesBibleService";
import { SERIES } from "@/ui/labels";
import { RECORD_GROUPS } from "@/ui/navigation";
import { seriesBookLabel } from "@/world/seriesHome";
import { ExportClient } from "./ExportClient";

export const dynamic = "force-dynamic";

const list = (value: string | string[] | undefined) => (value === undefined ? [] : Array.isArray(value) ? value : [value]);

export default async function ExportPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ record?: string | string[]; type?: string | string[]; group?: string; draft?: string }>;
}) {
  const { projectId } = await params;
  const query = await searchParams;
  const db = getDb();
  const [drafts, defaults, records, availableRefs] = await Promise.all([
    listManuscriptDrafts(db, projectId),
    getDraftDefaults(db, projectId),
    listRecords(db, projectId),
    listAvailableReferences(db, projectId, { linkableOnly: true }),
  ]);
  const selectedDraftId = resolveExportDraftId(drafts, defaults, query.draft ?? null);
  const draftOptions: DraftOption[] = drafts.map((d) => ({
    id: d.id,
    kind: d.kind,
    label: d.label,
    completedAt: d.completedAt?.toISOString() ?? null,
  }));
  const draftIds = new Map(
    (
      await db.record.findMany({
        where: { projectId, trashedAt: null },
        select: { id: true, draftId: true },
      })
    ).map((r) => [r.id, r.draftId] as const),
  );

  // Optional preselection from a "Export for ChatGPT" link; the author can still change every tick.
  const requestedIds = list(query.record);
  const types = new Set<RecordType>(list(query.type).filter(isRecordType));
  if (query.group === "world") RECORD_GROUPS.world.forEach((t) => types.add(t));
  const scopedLocal =
    drafts.length === 0 || !selectedDraftId
      ? records
      : records.filter((r) => !isManuscriptType(r.type) || draftIds.get(r.id) === selectedDraftId);
  const sharedExtras = availableRefs
    .filter((entry) => entry.isShared)
    .map((entry) => entry.record)
    .filter((r) => !scopedLocal.some((local) => local.id === r.id));
  const scoped = [...scopedLocal, ...sharedExtras];
  const homeById = new Map(
    availableRefs.flatMap((entry) =>
      entry.home ? [[entry.record.id, SERIES.homeBadge(seriesBookLabel(entry.home))] as const] : [],
    ),
  );
  const ids = new Set(scoped.map((r) => r.id));
  const missing = requestedIds.filter((id) => !ids.has(id));
  const preselected =
    requestedIds.length || types.size
      ? scoped.filter((r) => requestedIds.includes(r.id) || types.has(r.type)).map((r) => r.id)
      : null;
  const preselectedFrom =
    requestedIds.length && !types.size
      ? null
      : [...types].map((t) => RECORD_TYPE_LABELS[t]).join(", ");
  const base = `/projects/${encodeURIComponent(projectId)}`;

  return (
    <>
      <ProjectPageHeader projectId={projectId} title={EXPORT.heading} />
      <p className="muted small">
        Select the current records to bring into a ChatGPT conversation. The bundle includes record IDs, current revision
        numbers, types, authority statuses and protection flags, plus instructions and a JSON Schema so the assistant can
        return a compatible change package.
      </p>
      <HelpHint anchor="context-export" topic="context exports">
        This is a snapshot of the selected records for ChatGPT, not a backup. Export again after records change.
      </HelpHint>
      {drafts.length > 0 ? (
        <section className="row" style={{ flexWrap: "wrap", gap: "1rem", alignItems: "center" }}>
          <DraftScopeChip drafts={draftOptions} activeDraftId={selectedDraftId} />
          <VisitDraftSwitcher
            drafts={draftOptions}
            selectedDraftId={selectedDraftId}
            basePath={`${base}/export`}
            label="Export draft"
          />
        </section>
      ) : (
        <DraftScopeChip drafts={draftOptions} activeDraftId={selectedDraftId} />
      )}
      {preselected ? (
        <Banner tone="info">
          {EXPORT.preselected(preselected.length)}
          {preselectedFrom ? ` (${preselectedFrom})` : ""}. {EXPORT.preselectedNote}
          {missing.length ? ` ${EXPORT.notFound(missing.length)}` : ""}
        </Banner>
      ) : null}
      <ExportClient
        projectId={projectId}
        initialSelection={preselected}
        storyPoints={scoped
          .filter((r) => r.type === "manuscript_chapter" || r.type === "manuscript_scene")
          .map((r) => ({ id: r.id, title: r.title, type: r.type }))}
        records={scoped.map((r) => ({
          id: r.id,
          title: homeById.has(r.id) ? `${r.title} (${homeById.get(r.id)})` : r.title,
          type: r.type,
          revision: r.currentRevision,
          authorityStatus: r.authorityStatus,
          protected: r.protected,
        }))}
      />
    </>
  );
}
