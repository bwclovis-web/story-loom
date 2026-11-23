"use client";
import { Button } from "@/components/ui/Atoms/Button";

import { useEffect, useState, useTransition } from "react";
import { ContextSection } from "@/components/ContextSection";
import { RECORD_TYPE_LABELS } from "@/domain/recordTypes";
import type { ReadingPinView } from "@/server/services/readingPinService";
import { WRITE } from "@/ui/labels";
import {
  addReadingPinAction,
  listReadingPinsAction,
  removeReadingPinAction,
  reorderReadingPinsAction,
} from "../../write/actions";

/** Pin/unpin for the active draft scope on World pages (no Link to scene here). */
export function WorldPins({
  projectId,
  recordId,
  draftScopeId,
  initialPins,
  canPinCurrent,
}: {
  projectId: string;
  recordId: string;
  draftScopeId: string | null;
  initialPins: ReadingPinView[];
  /** Current World record is a linkable reference. */
  canPinCurrent: boolean;
}) {
  const [pins, setPins] = useState(initialPins);
  const [pending, startTransition] = useTransition();
  const pinned = pins.some((p) => p.recordId === recordId);

  useEffect(() => {
    setPins(initialPins);
  }, [initialPins]);

  const refresh = () =>
    listReadingPinsAction(projectId, draftScopeId).then((r) => {
      if (r.ok) setPins(r.pins);
    });

  return (
    <ContextSection title={WRITE.pinnedReferences} count={pins.length}>
      <p className="small muted">{WRITE.pinNote}</p>
      {canPinCurrent ? (
        <p className="row">
          {pinned ? (
            <Button
              type="button"
             
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const r = await removeReadingPinAction(projectId, recordId, draftScopeId);
                  if (r.ok && r.pins) setPins(r.pins);
                  else await refresh();
                })
              }
             variant="secondary" size="sm">
              {WRITE.unpinReference}
            </Button>
          ) : (
            <Button
              type="button"
             
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const r = await addReadingPinAction(projectId, recordId, draftScopeId);
                  if (r.ok && r.pins) setPins(r.pins);
                  else await refresh();
                })
              }
             variant="secondary" size="sm">
              {WRITE.pinReference}
            </Button>
          )}
        </p>
      ) : null}
      {pins.length === 0 ? (
        <p className="small muted">{WRITE.noPins}</p>
      ) : (
        <ul className="context-list">
          {pins.map((p, index) => (
            <li key={p.pinId}>
              <span className="context-item-title">{p.title}</span>
              <span className="small muted">{RECORD_TYPE_LABELS[p.type]}</span>
              <div className="row">
                <a className="small" href={`/projects/${encodeURIComponent(projectId)}/records/${encodeURIComponent(p.recordId)}`}>
                  {WRITE.openReference}
                </a>
                <Button
                  type="button"
                 
                  disabled={pending || index === 0}
                  onClick={() =>
                    startTransition(async () => {
                      const ids = pins.map((x) => x.recordId);
                      const next = [...ids];
                      const [moved] = next.splice(index, 1);
                      next.splice(index - 1, 0, moved!);
                      const r = await reorderReadingPinsAction(projectId, next, draftScopeId);
                      if (r.ok && r.pins) setPins(r.pins);
                    })
                  }
                 variant="secondary" size="sm">
                  {WRITE.movePinUp}
                </Button>
                <Button
                  type="button"
                 
                  disabled={pending || index === pins.length - 1}
                  onClick={() =>
                    startTransition(async () => {
                      const ids = pins.map((x) => x.recordId);
                      const next = [...ids];
                      const [moved] = next.splice(index, 1);
                      next.splice(index + 1, 0, moved!);
                      const r = await reorderReadingPinsAction(projectId, next, draftScopeId);
                      if (r.ok && r.pins) setPins(r.pins);
                    })
                  }
                 variant="secondary" size="sm">
                  {WRITE.movePinDown}
                </Button>
                <Button
                  type="button"
                 
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const r = await removeReadingPinAction(projectId, p.recordId, draftScopeId);
                      if (r.ok && r.pins) setPins(r.pins);
                    })
                  }
                 variant="secondary" size="sm">
                  {WRITE.unpinReference}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </ContextSection>
  );
}
