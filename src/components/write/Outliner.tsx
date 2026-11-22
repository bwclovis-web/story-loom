"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { DataTable } from "@/components/ui/DataTable";
import { saveSynopsisAction } from "@/app/projects/[projectId]/records/[recordId]/annotationActions";
import { saveChapterGoalAction, clearChapterGoalAction } from "@/app/projects/[projectId]/write/goals/actions";
import { saveOutlinerMetaAction } from "@/app/projects/[projectId]/write/outlinerActions";
import { RECORD_TYPE_LABELS } from "@/domain/recordTypes";
import { MANUSCRIPT_ANNOTATIONS, MANUSCRIPT_REPLACE, SCENE_META, WRITE } from "@/ui/labels";
import {
  MANUSCRIPT_SCENE_STATUSES,
  type ManuscriptSceneStatus,
} from "@/writing/manuscriptStructure";

export type OutlinerRow = {
  recordId: string;
  title: string;
  type: "manuscript_chapter" | "manuscript_scene";
  chapterTitle: string | null;
  number: string | null;
  synopsis: string;
  pov: string;
  sceneStatus: ManuscriptSceneStatus | "";
  words: number;
  wordTarget: number | null;
  locationTitle: string | null;
  continuityOpen: number;
  isProtected: boolean;
  revision: number;
  parentRecordId: string | null;
};

const STATUS_LABEL: Record<ManuscriptSceneStatus, string> = {
  outline: SCENE_META.outline,
  rough: SCENE_META.rough,
  revised: SCENE_META.revised,
  final: SCENE_META.final,
};

type SortKey = "order" | "title" | "words" | "pov" | "status" | "target";

function recordHref(base: string, recordId: string) {
  return `${base}/records/${encodeURIComponent(recordId)}`;
}

export function Outliner({
  projectId,
  rows,
}: {
  projectId: string;
  rows: OutlinerRow[];
}) {
  const base = `/projects/${encodeURIComponent(projectId)}`;
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const [local, setLocal] = useState(rows);
  const [filter, setFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | ManuscriptSceneStatus>("");
  const [sort, setSort] = useState<SortKey>("order");

  useEffect(() => setLocal(rows), [rows]);

  const visible = useMemo(() => {
    const q = filter.trim().toLocaleLowerCase();
    let list = local.filter((row) => {
      if (statusFilter && row.sceneStatus !== statusFilter) return false;
      if (!q) return true;
      const hay = `${row.title}\n${row.chapterTitle ?? ""}\n${row.synopsis}\n${row.pov}\n${row.locationTitle ?? ""}`.toLocaleLowerCase();
      return hay.includes(q);
    });
    if (sort === "title") list = [...list].sort((a, b) => a.title.localeCompare(b.title));
    else if (sort === "words") list = [...list].sort((a, b) => b.words - a.words || a.title.localeCompare(b.title));
    else if (sort === "pov") list = [...list].sort((a, b) => (a.pov || "zzz").localeCompare(b.pov || "zzz"));
    else if (sort === "status") list = [...list].sort((a, b) => (a.sceneStatus || "zzz").localeCompare(b.sceneStatus || "zzz"));
    else if (sort === "target") {
      list = [...list].sort((a, b) => (b.wordTarget ?? -1) - (a.wordTarget ?? -1));
    }
    return list;
  }, [local, filter, statusFilter, sort]);

  const patchRow = (recordId: string, patch: Partial<OutlinerRow>) => {
    setLocal((prev) => prev.map((row) => (row.recordId === recordId ? { ...row, ...patch } : row)));
  };

  const saveSynopsis = (row: OutlinerRow, body: string) => {
    setMessage(null);
    startTransition(async () => {
      try {
        await saveSynopsisAction(projectId, row.recordId, body);
        patchRow(row.recordId, { synopsis: body });
        setMessage({ error: false, text: MANUSCRIPT_ANNOTATIONS.corkboardSaved });
      } catch (error) {
        setMessage({ error: true, text: (error as Error).message || "Could not save synopsis." });
      }
    });
  };

  const saveMeta = (row: OutlinerRow, patch: { pov?: string; sceneStatus?: string }) => {
    if (row.isProtected) {
      setMessage({ error: true, text: WRITE.outlinerProtected });
      return;
    }
    setMessage(null);
    startTransition(async () => {
      const result = await saveOutlinerMetaAction(projectId, row.recordId, {
        expectedRevision: row.revision,
        ...patch,
      });
      if (!result.ok) {
        setMessage({ error: true, text: result.issues?.map((i) => i.message).join(" ") ?? "Save failed." });
        return;
      }
      patchRow(row.recordId, {
        ...(patch.pov !== undefined ? { pov: patch.pov } : {}),
        ...(patch.sceneStatus !== undefined
          ? { sceneStatus: (patch.sceneStatus || "") as ManuscriptSceneStatus | "" }
          : {}),
        ...(result.revision !== undefined ? { revision: result.revision } : {}),
      });
      setMessage({ error: false, text: result.message ?? "Saved." });
    });
  };

  const saveTarget = (row: OutlinerRow, raw: string) => {
    if (row.type !== "manuscript_chapter") return;
    setMessage(null);
    const trimmed = raw.trim();
    startTransition(async () => {
      if (!trimmed) {
        const result = await clearChapterGoalAction(projectId, row.recordId);
        if (!result.ok) {
          setMessage({ error: true, text: result.issues?.map((i) => i.message).join(" ") ?? "Clear failed." });
          return;
        }
        patchRow(row.recordId, { wordTarget: null });
        setMessage({ error: false, text: result.message ?? "Cleared." });
        return;
      }
      const form = new FormData();
      form.set("recordId", row.recordId);
      form.set("targetWords", trimmed);
      const result = await saveChapterGoalAction(projectId, { ok: true }, form);
      if (!result.ok) {
        setMessage({ error: true, text: result.issues?.map((i) => i.message).join(" ") ?? "Save failed." });
        return;
      }
      patchRow(row.recordId, { wordTarget: Math.max(1, Math.floor(Number(trimmed)) || 1) });
      setMessage({ error: false, text: result.message ?? "Saved." });
    });
  };

  return (
    <div className="outliner">
      <p className="small muted corkboard-lead">{WRITE.outlinerLead}</p>
      <div className="outliner-toolbar">
        <label className="outliner-filter">
          <span className="sr-only">{WRITE.outlinerFilter}</span>
          <input
            type="search"
            value={filter}
            placeholder={WRITE.outlinerFilter}
            onChange={(event) => setFilter(event.target.value)}
          />
        </label>
        <label>
          <span className="sr-only">{SCENE_META.status}</span>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "" | ManuscriptSceneStatus)}>
            <option value="">{WRITE.outlinerAllStatuses}</option>
            {MANUSCRIPT_SCENE_STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABEL[status]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">{WRITE.outlinerSort}</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as SortKey)}>
            <option value="order">{WRITE.outlinerSortOrder}</option>
            <option value="title">{WRITE.outlinerSortTitle}</option>
            <option value="words">{WRITE.outlinerSortWords}</option>
            <option value="pov">{WRITE.outlinerSortPov}</option>
            <option value="status">{WRITE.outlinerSortStatus}</option>
            <option value="target">{WRITE.outlinerSortTarget}</option>
          </select>
        </label>
      </div>
      <p className={message?.error ? "small error-text" : "small"} role="status">
        {pending ? WRITE.outlinerSaving : (message?.text ?? "")}
      </p>
      {visible.length === 0 ? (
        <p className="outline-empty">{local.length === 0 ? MANUSCRIPT_ANNOTATIONS.corkboardEmpty : WRITE.noMatches}</p>
      ) : (
        <DataTable
          label={WRITE.outlinerTab}
          columns={[
            { id: "title", header: WRITE.outlinerColTitle, className: "outliner-title-cell" },
            { id: "words", header: WRITE.outlinerColWords, className: "outliner-num" },
            { id: "target", header: WRITE.outlinerColTarget },
            { id: "pov", header: SCENE_META.pov },
            { id: "status", header: SCENE_META.status },
            { id: "location", header: WRITE.outlinerColLocation, className: "small" },
            { id: "synopsis", header: WRITE.outlinerColSynopsis },
            { id: "continuity", header: WRITE.outlinerColContinuity, className: "outliner-num" },
          ]}
          rows={visible.map((row) => ({
            id: row.recordId,
            "data-type": row.type,
            "data-protected": row.isProtected ? "" : undefined,
            cells: [
              <>
                {row.number ? <span className="outliner-number">{row.number}</span> : null}
                <span className="outliner-kind">
                  {row.type === "manuscript_chapter" ? WRITE.chapterKind : WRITE.sceneKind}
                </span>
                <Link href={recordHref(base, row.recordId)} className="outliner-title">
                  {row.title}
                </Link>
                {row.chapterTitle ? <span className="small muted">{row.chapterTitle}</span> : null}
                {row.isProtected ? <span className="badge subtle">{MANUSCRIPT_REPLACE.protected}</span> : null}
              </>,
              row.words,
              row.type === "manuscript_chapter" ? (
                <input
                  type="number"
                  min={1}
                  className="outliner-input outliner-input-num"
                  defaultValue={row.wordTarget ?? ""}
                  disabled={pending}
                  aria-label={WRITE.outlinerColTarget}
                  onBlur={(event) => {
                    const next = event.target.value.trim();
                    const prev = row.wordTarget == null ? "" : String(row.wordTarget);
                    if (next === prev) return;
                    saveTarget(row, next);
                  }}
                />
              ) : (
                <span className="muted">—</span>
              ),
              <input
                key={`${row.recordId}-pov`}
                type="text"
                className="outliner-input"
                defaultValue={row.pov}
                disabled={pending || row.isProtected}
                aria-label={SCENE_META.pov}
                onBlur={(event) => {
                  const next = event.target.value;
                  if (next === row.pov) return;
                  saveMeta(row, { pov: next });
                }}
              />,
              <select
                key={`${row.recordId}-status`}
                className="outliner-input"
                defaultValue={row.sceneStatus}
                disabled={pending || row.isProtected}
                aria-label={SCENE_META.status}
                onChange={(event) => {
                  const next = event.target.value;
                  if (next === row.sceneStatus) return;
                  saveMeta(row, { sceneStatus: next });
                }}
              >
                <option value="">{SCENE_META.statusNone}</option>
                {MANUSCRIPT_SCENE_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {STATUS_LABEL[status]}
                  </option>
                ))}
              </select>,
              row.locationTitle ?? <span className="muted">—</span>,
              <textarea
                key={`${row.recordId}-synopsis`}
                className="outliner-synopsis"
                defaultValue={row.synopsis}
                rows={2}
                disabled={pending}
                aria-label={MANUSCRIPT_ANNOTATIONS.synopsis}
                onBlur={(event) => {
                  const next = event.target.value;
                  if (next === row.synopsis) return;
                  saveSynopsis(row, next);
                }}
              />,
              row.continuityOpen > 0 ? (
                <Link href={`${base}/continuity`}>{row.continuityOpen}</Link>
              ) : (
                <span className="muted">0</span>
              ),
            ],
          }))}
        />
      )}
      <p className="small muted">
        {RECORD_TYPE_LABELS.manuscript_chapter} / {RECORD_TYPE_LABELS.manuscript_scene} · {WRITE.outlinerSortNote}{" "}
        {WRITE.outlinerBookOrderHint}
      </p>
    </div>
  );
}
