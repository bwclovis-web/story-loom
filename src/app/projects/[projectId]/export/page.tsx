import { DraftScopeChip, VisitDraftSwitcher, type DraftOption } from "@/components/drafts/DraftControls";
import { HelpHint } from "@/components/HelpHint";
import { isManuscriptType, isRecordType, RECORD_TYPE_LABELS, type RecordType } from "@/domain/recordTypes";
import { getDb } from "@/server/db";
import { resolveExportDraftId } from "@/server/draftSelection";
import { getDraftDefaults, listManuscriptDrafts } from "@/server/services/draftService";
import { EXPORT } from "@/ui/labels";
import { listRecords } from "@/server/services/recordService";
import { RECORD_GROUPS } from "@/ui/navigation";
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
  const [drafts, defaults, records] = await Promise.all([
    listManuscriptDrafts(db, projectId),
    getDraftDefaults(db, projectId),
    listRecords(db, projectId),
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
  const scoped =
    drafts.length === 0 || !selectedDraftId
      ? records
      : records.filter((r) => !isManuscriptType(r.type) || draftIds.get(r.id) === selectedDraftId);
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
      <h1>{EXPORT.heading}</h1>
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
        <div className="banner info" role="status">
          {EXPORT.preselected(preselected.length)}
          {preselectedFrom ? ` (${preselectedFrom})` : ""}. {EXPORT.preselectedNote}
          {missing.length ? ` ${EXPORT.notFound(missing.length)}` : ""}
        </div>
      ) : null}
      <ExportClient
        projectId={projectId}
        initialSelection={preselected}
        records={scoped.map((r) => ({
          id: r.id,
          title: r.title,
          type: r.type,
          revision: r.currentRevision,
          authorityStatus: r.authorityStatus,
          protected: r.protected,
        }))}
      />
    </>
  );
}
