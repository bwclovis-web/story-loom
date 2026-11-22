"use client";

import { useEffect, useId, useState } from "react";
import { IssueList } from "@/components/IssueList";
import { ButtonLink } from "@/components/ui/Button";
import type { Issue } from "@/domain/issues";
import type { SceneAtLocation, SceneLocationCatalog } from "@/server/services/sceneLocationService";
import { WORLD } from "@/ui/labels";
import { withCanvasReturn } from "@/world/canvasReturn";
import { listScenesAtLocationAction } from "../../write/actions";

export function MarkerScenes({
  projectId,
  locationRecordId,
  returnPath = null,
  refreshKey = 0,
  compact = false,
}: {
  projectId: string;
  locationRecordId: string;
  returnPath?: string | null;
  refreshKey?: number;
  compact?: boolean;
}) {
  const idPrefix = useId();
  const [draft, setDraft] = useState("all");
  const [book, setBook] = useState("all");
  const [catalog, setCatalog] = useState<SceneLocationCatalog | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);

  useEffect(() => {
    setDraft("all");
    setBook("all");
  }, [locationRecordId]);

  useEffect(() => {
    let cancelled = false;
    void listScenesAtLocationAction(projectId, locationRecordId, { draft, book }).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setCatalog(result.catalog);
        setIssues([]);
      } else {
        setIssues(result.issues);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, locationRecordId, draft, book, refreshKey]);

  return (
    <section className="stack" aria-labelledby={compact ? undefined : `${idPrefix}-scenes`}>
      {compact ? null : <h3 id={`${idPrefix}-scenes`}>{WORLD.scenesAtLocation}</h3>}
      {compact ? null : <p className="small muted">{WORLD.scenesAtLocationNote}</p>}
      <div className="row">
        <label>
          {WORLD.sceneDraftFilter}
          <select value={draft} onChange={(event) => setDraft(event.target.value)}>
            <option value="all">{WORLD.allDrafts}</option>
            <option value="unscoped">{WORLD.unscopedDraft}</option>
            {(catalog?.drafts ?? []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          {WORLD.sceneBookFilter}
          <select value={book} onChange={(event) => setBook(event.target.value)}>
            <option value="all">{WORLD.allBooks}</option>
            <option value="ungrouped">{WORLD.ungroupedBook}</option>
            {(catalog?.books ?? []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <IssueList issues={issues} />
      {!catalog ? (
        <p className="small muted" role="status">
          {WORLD.inspectorLoading}
        </p>
      ) : catalog.scenes.length === 0 ? (
        <p className="small muted">{WORLD.noScenesAtLocation}</p>
      ) : (
        <ul className="context-list">
          {catalog.scenes.map((scene) => (
            <SceneRow key={scene.recordId} projectId={projectId} scene={scene} returnPath={returnPath} />
          ))}
        </ul>
      )}
    </section>
  );
}

function SceneRow({
  projectId,
  scene,
  returnPath,
}: {
  projectId: string;
  scene: SceneAtLocation;
  returnPath: string | null;
}) {
  const recordPath = `/projects/${encodeURIComponent(projectId)}/records/${encodeURIComponent(scene.recordId)}`;
  const sceneHref = returnPath ? withCanvasReturn(recordPath, returnPath) : recordPath;
  const openLabel = scene.type === "manuscript_scene" ? WORLD.openSceneInWrite : WORLD.openChapterInWrite;
  return (
    <li>
      <span className="context-item-title" title={scene.title}>
        {scene.title}
      </span>
      <span className="small muted">
        {scene.chapterTitle ? `${scene.chapterTitle} · ` : ""}
        {scene.draftLabel ? `${scene.draftLabel} · ` : ""}
        {scene.isPrimary ? WORLD.primaryBadge : ""}
      </span>
      <ButtonLink href={sceneHref} variant="secondary" size="sm">
        {openLabel}
        <span className="sr-only"> {scene.title}</span>
      </ButtonLink>
    </li>
  );
}
