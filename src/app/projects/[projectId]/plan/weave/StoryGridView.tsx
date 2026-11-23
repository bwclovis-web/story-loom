"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IssueList } from "@/components/IssueList";
import { Button } from "@/components/ui/Atoms/Button";
import { TextField } from "@/components/ui/TextField";
import type { Issue } from "@/domain/issues";
import type { WeaveBeatView, WeaveThreadView } from "@/server/services/weaveService";
import type { WeavePlanningRowView, WeaveStructureView } from "@/server/services/weaveStructureService";
import { WEAVE } from "@/ui/labels";
import {
  addWeavePlanningRowAction,
  addWeaveThreadAction,
  placeIdeaOnPlanningRowAction,
  renameWeavePlanningRowAction,
  reorderWeavePlanningRowsAction,
} from "./actions";
import { DeleteWeavePlanButton } from "./DeleteWeavePlanButton";

export function StoryGridView({
  projectId,
  gridId,
  gridTitle,
  threads,
  planningRows,
  beats,
  structures,
}: {
  projectId: string;
  gridId: string;
  gridTitle: string;
  threads: WeaveThreadView[];
  planningRows: WeavePlanningRowView[];
  beats: WeaveBeatView[];
  structures: WeaveStructureView[];
}) {
  const router = useRouter();
  const [issues, setIssues] = useState<Issue[]>([]);
  const [showBadges, setShowBadges] = useState(true);
  const [trayOpen, setTrayOpen] = useState(true);
  const [pending, startTransition] = useTransition();

  const badgesByBeat = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const structure of structures) {
      for (const stage of structure.stages) {
        for (const idea of stage.ideas) {
          const list = map.get(idea.beatId) ?? [];
          list.push(`${structure.title}: ${stage.title}`);
          map.set(idea.beatId, list);
        }
      }
    }
    return map;
  }, [structures]);

  const unassigned = beats.filter((beat) => !beat.planningRowId);
  const orderedRows = [...planningRows].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  const orderedThreads = [...threads].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));

  const moveRow = (rowId: string, direction: -1 | 1) => {
    const index = orderedRows.findIndex((row) => row.id === rowId);
    const swapWith = index + direction;
    if (index < 0 || swapWith < 0 || swapWith >= orderedRows.length) return;
    const next = orderedRows.map((row) => row.id);
    const temp = next[index]!;
    next[index] = next[swapWith]!;
    next[swapWith] = temp;
    startTransition(async () => {
      const result = await reorderWeavePlanningRowsAction(projectId, gridId, next);
      if (!result.ok) setIssues(result.issues);
      else router.refresh();
    });
  };

  return (
    <section className="weave-story-grid" aria-labelledby="story-grid-heading">
      <div className="weave-story-grid-toolbar">
        <div>
          <h2 id="story-grid-heading">{WEAVE.storyGridHeading}</h2>
          <p className="small muted">{WEAVE.storyGridLead}</p>
        </div>
        <div className="row" style={{ gap: "0.35rem", flexWrap: "wrap" }}>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await addWeavePlanningRowAction(projectId, gridId, {
                  title: `Moment ${orderedRows.length + 1}`,
                });
                if (!result.ok) setIssues(result.issues);
                else router.refresh();
              })
            }
          >
            {WEAVE.planningRowAdd}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await addWeaveThreadAction(projectId, gridId, `Thread ${orderedThreads.length + 1}`);
                if (!result.ok) setIssues(result.issues);
                else router.refresh();
              })
            }
          >
            {WEAVE.addThread}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setShowBadges((on) => !on)}>
            {showBadges ? WEAVE.storyGridHideBadges : WEAVE.storyGridShowBadges}
          </Button>
          <DeleteWeavePlanButton
            projectId={projectId}
            gridId={gridId}
            title={gridTitle}
            redirectToLibrary
          />
        </div>
      </div>
      <IssueList issues={issues} />

      {!orderedRows.length ? <p className="small muted">{WEAVE.storyGridEmptyMoments}</p> : null}
      {!orderedThreads.length ? <p className="small muted">{WEAVE.storyGridEmptyThreads}</p> : null}

      {orderedRows.length && orderedThreads.length ? (
        <div className="weave-story-grid-scroll">
          <table className="weave-story-grid-table">
            <thead>
              <tr>
                <th scope="col">{WEAVE.planningRowTitle}</th>
                {orderedThreads.map((thread) => (
                  <th key={thread.id} scope="col">
                    {thread.title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orderedRows.map((row, rowIndex) => (
                <tr key={row.id}>
                  <th scope="row">
                    <TextField
                      className="weave-story-grid-row-title"
                      label={WEAVE.planningRowRename}
                      labelClassName="sr-only"
                      defaultValue={row.title}
                      onBlur={(event) => {
                        const title = event.target.value.trim();
                        if (title === row.title) return;
                        startTransition(async () => {
                          const result = await renameWeavePlanningRowAction(projectId, gridId, row.id, title);
                          if (!result.ok) setIssues(result.issues);
                          else router.refresh();
                        });
                      }}
                    />
                    <div className="row" style={{ gap: "0.25rem", marginTop: "0.25rem" }}>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={pending || rowIndex === 0}
                        aria-label={WEAVE.storyGridMoveUp}
                        onClick={() => moveRow(row.id, -1)}
                      >
                        ↑
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={pending || rowIndex >= orderedRows.length - 1}
                        aria-label={WEAVE.storyGridMoveDown}
                        onClick={() => moveRow(row.id, 1)}
                      >
                        ↓
                      </Button>
                    </div>
                  </th>
                  {orderedThreads.map((thread) => {
                    const cellBeats = beats
                      .filter((beat) => beat.planningRowId === row.id && beat.threadId === thread.id)
                      .sort((a, b) => a.cellOrder - b.cellOrder || a.id.localeCompare(b.id));
                    return (
                      <td key={thread.id}>
                        <div
                          className="weave-story-grid-cell"
                          data-planning-row={row.id}
                          data-thread={thread.id}
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={(event) => {
                            event.preventDefault();
                            const beatId = event.dataTransfer.getData("text/weave-beat");
                            if (!beatId) return;
                            startTransition(async () => {
                              const result = await placeIdeaOnPlanningRowAction(projectId, gridId, beatId, {
                                planningRowId: row.id,
                                threadId: thread.id,
                              });
                              if (!result.ok) setIssues(result.issues);
                              else router.refresh();
                            });
                          }}
                        >
                          {cellBeats.map((beat) => (
                            <article
                              key={beat.id}
                              className="weave-story-grid-card"
                              draggable
                              onDragStart={(event) => event.dataTransfer.setData("text/weave-beat", beat.id)}
                              tabIndex={0}
                              onKeyDown={(event) => {
                                if (event.key !== "Enter") return;
                                const index = orderedThreads.findIndex((t) => t.id === thread.id);
                                const next = orderedThreads[(index + 1) % orderedThreads.length];
                                if (!next) return;
                                startTransition(async () => {
                                  const result = await placeIdeaOnPlanningRowAction(projectId, gridId, beat.id, {
                                    planningRowId: row.id,
                                    threadId: next.id,
                                  });
                                  if (!result.ok) setIssues(result.issues);
                                  else router.refresh();
                                });
                              }}
                            >
                              <strong>{beat.title}</strong>
                              {beat.body ? <p className="small muted">{beat.body.slice(0, 120)}</p> : null}
                              {showBadges
                                ? (badgesByBeat.get(beat.id) ?? []).map((badge) => (
                                    <span key={badge} className="weave-structure-badge">
                                      {badge}
                                    </span>
                                  ))
                                : null}
                            </article>
                          ))}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <details className="weave-story-grid-tray" open={trayOpen} onToggle={(event) => setTrayOpen(event.currentTarget.open)}>
        <summary>
          {WEAVE.storyGridUnassigned} ({unassigned.length})
        </summary>
        <ul className="weave-story-grid-tray-list">
          {unassigned.map((beat) => (
            <li key={beat.id}>
              <article
                className="weave-story-grid-card"
                draggable
                onDragStart={(event) => event.dataTransfer.setData("text/weave-beat", beat.id)}
              >
                <strong>{beat.title}</strong>
                {showBadges
                  ? (badgesByBeat.get(beat.id) ?? []).map((badge) => (
                      <span key={badge} className="weave-structure-badge">
                        {badge}
                      </span>
                    ))
                  : null}
                {orderedRows[0] && orderedThreads[0] ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        const result = await placeIdeaOnPlanningRowAction(projectId, gridId, beat.id, {
                          planningRowId: orderedRows[0]!.id,
                          threadId: orderedThreads[0]!.id,
                        });
                        if (!result.ok) setIssues(result.issues);
                        else router.refresh();
                      })
                    }
                  >
                    Place in first cell
                  </Button>
                ) : null}
              </article>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
