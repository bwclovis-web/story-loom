"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition, type DragEvent, type KeyboardEvent } from "react";
import { saveSynopsisAction } from "@/app/projects/[projectId]/records/[recordId]/annotationActions";
import { moveInBookAction } from "@/app/projects/[projectId]/write/actions";
import { Button } from "@/components/ui/Button";
import { RECORD_TYPE_LABELS, type RecordType } from "@/domain/recordTypes";
import { BOOK_ORDER, MANUSCRIPT_ANNOTATIONS, MANUSCRIPT_STRUCTURE, SCENE_META } from "@/ui/labels";
import type { ManuscriptSceneStatus } from "@/writing/manuscriptStructure";

export type CorkboardCard = {
  recordId: string;
  title: string;
  type: string;
  synopsis: string;
  pov: string;
  sceneStatus: ManuscriptSceneStatus | "";
  parentRecordId: string | null;
};

export type CorkboardGroup = {
  chapter: CorkboardCard;
  scenes: CorkboardCard[];
};

const STATUS_LABEL: Record<ManuscriptSceneStatus, string> = {
  outline: SCENE_META.outline,
  rough: SCENE_META.rough,
  revised: SCENE_META.revised,
  final: SCENE_META.final,
};

function recordHref(base: string, recordId: string) {
  return `${base}/records/${encodeURIComponent(recordId)}`;
}

export function Corkboard({
  projectId,
  groups,
  unplaced,
}: {
  projectId: string;
  groups: CorkboardGroup[];
  unplaced: CorkboardCard[];
}) {
  const base = `/projects/${encodeURIComponent(projectId)}`;
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const dragged = useRef<string | null>(null);
  const chapters = groups.map((group) => group.chapter);

  const move = (recordId: string, parentRecordId: string | null, index: number) => {
    setMessage(null);
    startTransition(async () => {
      const result = await moveInBookAction(projectId, { recordId, parentRecordId, index });
      if (!result.ok) setMessage({ error: true, text: result.issues.map((issue) => issue.message).join(" ") });
    });
  };

  const dropOn = (event: DragEvent, targetId: string, siblings: CorkboardCard[], parentRecordId: string | null) => {
    event.preventDefault();
    const id = event.dataTransfer.getData("text/plain") || dragged.current;
    dragged.current = null;
    if (!id || id === targetId || !siblings.some((card) => card.recordId === id)) return;
    const index = siblings.filter((card) => card.recordId !== id).findIndex((card) => card.recordId === targetId);
    if (index < 0) return;
    move(id, parentRecordId, index);
  };

  return (
    <div className="corkboard-board">
      <p className={message?.error ? "small error-text" : "small"} role="status">
        {pending ? BOOK_ORDER.moving : (message?.text ?? "")}
      </p>
      {groups.length === 0 && unplaced.length === 0 ? <p className="outline-empty">{MANUSCRIPT_ANNOTATIONS.corkboardEmpty}</p> : null}
      {groups.map((group, index) => (
        <section key={group.chapter.recordId} className="corkboard-group" aria-label={group.chapter.title}>
          <CorkboardCardView
            base={base}
            projectId={projectId}
            card={group.chapter}
            index={index}
            siblings={chapters}
            pending={pending}
            dragged={dragged}
            onMove={move}
            onDrop={dropOn}
          />
          {group.scenes.length ? (
            <ul className="corkboard-scenes">
              {group.scenes.map((scene, sceneIndex) => (
                <li key={scene.recordId}>
                  <CorkboardCardView
                    base={base}
                    projectId={projectId}
                    card={scene}
                    index={sceneIndex}
                    siblings={group.scenes}
                    pending={pending}
                    dragged={dragged}
                    onMove={move}
                    onDrop={dropOn}
                  />
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ))}
      {unplaced.length ? (
        <section aria-label={BOOK_ORDER.unplaced}>
          <h3>{BOOK_ORDER.unplaced}</h3>
          <p className="small muted">{BOOK_ORDER.unplacedNote}</p>
          <ul className="corkboard-scenes">
            {unplaced.map((card) => (
              <li key={card.recordId}>
                <CorkboardCardView
                  base={base}
                  projectId={projectId}
                  card={card}
                  index={0}
                  siblings={[card]}
                  pending={pending}
                  dragged={dragged}
                  onMove={move}
                  onDrop={dropOn}
                  reorder={false}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function CorkboardCardView({
  base,
  projectId,
  card,
  index,
  siblings,
  pending,
  dragged,
  onMove,
  onDrop,
  reorder = true,
}: {
  base: string;
  projectId: string;
  card: CorkboardCard;
  index: number;
  siblings: CorkboardCard[];
  pending: boolean;
  dragged: { current: string | null };
  onMove: (recordId: string, parentRecordId: string | null, index: number) => void;
  onDrop: (event: DragEvent, targetId: string, siblings: CorkboardCard[], parentRecordId: string | null) => void;
  reorder?: boolean;
}) {
  const [synopsis, setSynopsis] = useState(card.synopsis);
  const [saved, setSaved] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const typeLabel = RECORD_TYPE_LABELS[card.type as RecordType] ?? card.type;

  useEffect(() => {
    setSynopsis(card.synopsis);
  }, [card.synopsis]);

  const onKeyDown = (event: KeyboardEvent) => {
    if (!reorder) return;
    const target = event.target;
    if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement || target instanceof HTMLSelectElement) return;
    if (!event.altKey) return;
    if (event.key === "ArrowUp" && index > 0) {
      event.preventDefault();
      onMove(card.recordId, card.parentRecordId, index - 1);
    }
    if (event.key === "ArrowDown" && index < siblings.length - 1) {
      event.preventDefault();
      onMove(card.recordId, card.parentRecordId, index + 1);
    }
  };

  return (
    <article
      className={`manuscript-corkboard-card panel${over ? " is-drop" : ""}`}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onDragOver={(event) => {
        if (!reorder) return;
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        setOver(false);
        if (reorder) onDrop(event, card.recordId, siblings, card.parentRecordId);
      }}
    >
      <div className="row" style={{ justifyContent: "space-between", gap: "0.5rem" }}>
        <div>
          <p className="small muted">{typeLabel}</p>
          <h3 className="manuscript-corkboard-title">{card.title}</h3>
        </div>
        <Link className="small" href={recordHref(base, card.recordId)}>
          {MANUSCRIPT_ANNOTATIONS.openRecord}
        </Link>
      </div>
      {card.pov || card.sceneStatus ? (
        <p className="corkboard-badges">
          {card.pov ? <span className="corkboard-badge">{card.pov}</span> : null}
          {card.sceneStatus ? <span className="corkboard-badge">{STATUS_LABEL[card.sceneStatus]}</span> : null}
        </p>
      ) : null}
      <label>
        {MANUSCRIPT_ANNOTATIONS.synopsis}
        <textarea
          className="manuscript-corkboard-synopsis"
          value={synopsis}
          placeholder={MANUSCRIPT_ANNOTATIONS.synopsisPlaceholder}
          onChange={(event) => {
            setSynopsis(event.target.value);
            setSaved(null);
          }}
        />
      </label>
      <div className="row corkboard-actions">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={pending}
          onClick={() => {
            setSaved(null);
            startSave(projectId, card.recordId, synopsis, setSaved);
          }}
        >
          {MANUSCRIPT_ANNOTATIONS.saveSynopsis}
        </Button>
        {reorder ? (
          <>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              draggable
              disabled={pending}
              aria-label={MANUSCRIPT_STRUCTURE.drag}
              onDragStart={(event) => {
                dragged.current = card.recordId;
                event.dataTransfer.setData("text/plain", card.recordId);
                event.dataTransfer.effectAllowed = "move";
              }}
            >
              {MANUSCRIPT_STRUCTURE.drag}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={pending || index === 0}
              aria-label={BOOK_ORDER.moveUpLabel(card.title)}
              onClick={() => onMove(card.recordId, card.parentRecordId, index - 1)}
            >
              {BOOK_ORDER.moveUp}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={pending || index >= siblings.length - 1}
              aria-label={BOOK_ORDER.moveDownLabel(card.title)}
              onClick={() => onMove(card.recordId, card.parentRecordId, index + 1)}
            >
              {BOOK_ORDER.moveDown}
            </Button>
          </>
        ) : null}
        {saved ? <span className="small muted">{saved}</span> : null}
      </div>
    </article>
  );
}

function startSave(projectId: string, recordId: string, body: string, setSaved: (text: string | null) => void) {
  void saveSynopsisAction(projectId, recordId, body)
    .then(() => setSaved(MANUSCRIPT_ANNOTATIONS.corkboardSaved))
    .catch(() => setSaved(null));
}
