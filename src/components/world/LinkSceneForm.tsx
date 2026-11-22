"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { IssueList } from "@/components/IssueList";
import { Button } from "@/components/ui/Button";
import type { Issue } from "@/domain/issues";
import type { LinkableManuscript } from "@/server/services/sceneLocationService";
import { WORLD } from "@/ui/labels";
import { linkSceneToReferenceAction, listLinkableManuscriptsAction } from "@/app/projects/[projectId]/write/actions";

/** The author picks a chapter or scene. Nothing is linked until they submit. */
export function LinkSceneForm({
  projectId,
  locationRecordId,
  protectedReference,
  onLinked,
}: {
  projectId: string;
  locationRecordId: string;
  protectedReference: boolean;
  onLinked?: (message: string) => void;
}) {
  const idPrefix = useId();
  const [manuscripts, setManuscripts] = useState<LinkableManuscript[] | null>(null);
  const [choice, setChoice] = useState("");
  const [primary, setPrimary] = useState(false);
  const [confirmProtected, setConfirmProtected] = useState(false);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    setChoice("");
    setPrimary(false);
    setConfirmProtected(false);
    void listLinkableManuscriptsAction(projectId, locationRecordId).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setManuscripts(result.manuscripts);
        setIssues([]);
      } else {
        setManuscripts([]);
        setIssues(result.issues);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, locationRecordId]);

  return (
    <form
      className="stack"
      aria-labelledby={`${idPrefix}-link`}
      onSubmit={(event) => {
        event.preventDefault();
        if (!choice) return;
        startTransition(async () => {
          const result = await linkSceneToReferenceAction(projectId, locationRecordId, choice, {
            isPrimary: primary,
            confirmProtected,
          });
          if (!result.ok) {
            setIssues(result.issues);
            return;
          }
          setIssues([]);
          setChoice("");
          setPrimary(false);
          setConfirmProtected(false);
          setManuscripts((current) => current?.filter((item) => item.id !== choice) ?? current);
          onLinked?.(WORLD.linkSceneSaved);
        });
      }}
    >
      <h3 id={`${idPrefix}-link`}>{WORLD.linkScene}</h3>
      <p className="small muted">{WORLD.linkSceneNote}</p>
      <label>
        {WORLD.linkSceneChoose}
        <select
          value={choice}
          onChange={(event) => setChoice(event.target.value)}
          disabled={pending || !manuscripts || manuscripts.length === 0}
        >
          <option value="">{WORLD.linkSceneChoose}</option>
          {(manuscripts ?? []).map((item) => (
            <option key={item.id} value={item.id}>
              {item.chapterTitle ? `${item.chapterTitle} — ${item.title}` : item.title}
            </option>
          ))}
        </select>
      </label>
      {manuscripts && manuscripts.length === 0 ? <p className="small muted">{WORLD.linkSceneNone}</p> : null}
      <label className="scene-location-check">
        <input type="checkbox" checked={primary} onChange={(event) => setPrimary(event.target.checked)} disabled={pending} />
        {WORLD.linkScenePrimary}
      </label>
      {protectedReference ? (
        <label className="scene-location-check">
          <input
            type="checkbox"
            checked={confirmProtected}
            onChange={(event) => setConfirmProtected(event.target.checked)}
            disabled={pending}
          />
          {WORLD.linkSceneProtected}
        </label>
      ) : null}
      <IssueList issues={issues} />
      <Button type="submit" size="sm" disabled={pending || !choice || (protectedReference && !confirmProtected)}>
        {WORLD.linkScene}
      </Button>
    </form>
  );
}
