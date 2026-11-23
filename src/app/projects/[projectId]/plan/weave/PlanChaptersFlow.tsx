"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IssueList } from "@/components/IssueList";
import { Button } from "@/components/ui/Atoms/Button";
import { Select } from "@/components/ui/Atoms/Select";
import { TextField } from "@/components/ui/TextField";
import type { Issue } from "@/domain/issues";
import type { WeaveBeatView } from "@/server/services/weaveService";
import type { WeavePlanChapterOp } from "@/server/services/weaveStructureService";
import { WEAVE } from "@/ui/labels";
import { applyWeavePlanChapterMappingsAction } from "./actions";

type DraftChoice = { beatId: string; mode: "skip" | "link" | "create"; recordId: string; title: string };

export function PlanChaptersFlow({
  projectId,
  gridId,
  beats,
  manuscriptChoices,
  draftId,
  onClose,
}: {
  projectId: string;
  gridId: string;
  beats: WeaveBeatView[];
  manuscriptChoices: Array<{ id: string; title: string; typeLabel: string }>;
  draftId?: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const unlinked = useMemo(() => beats.filter((beat) => !beat.manuscriptRecordId), [beats]);
  const [drafts, setDrafts] = useState<Record<string, DraftChoice>>(() =>
    Object.fromEntries(
      unlinked.map((beat) => [
        beat.id,
        {
          beatId: beat.id,
          mode: "skip" as const,
          recordId: manuscriptChoices[0]?.id ?? "",
          title: beat.title || "Chapter",
        },
      ]),
    ),
  );
  const [review, setReview] = useState(false);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [pending, startTransition] = useTransition();

  const planned = Object.values(drafts).filter((d) => d.mode !== "skip");

  if (!unlinked.length) {
    return (
      <section className="panel weave-plan-chapters" aria-labelledby="plan-chapters-heading">
        <h2 id="plan-chapters-heading">{WEAVE.planChapters}</h2>
        <p className="small muted">{WEAVE.planChaptersNone}</p>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </section>
    );
  }

  return (
    <section className="panel weave-plan-chapters" aria-labelledby="plan-chapters-heading">
      <h2 id="plan-chapters-heading">{WEAVE.planChapters}</h2>
      <p className="small muted">{WEAVE.planChaptersLead}</p>
      <IssueList issues={issues} />

      {!review ? (
        <ul className="weave-plan-chapters-list">
          {unlinked.map((beat) => {
            const draft = drafts[beat.id]!;
            return (
              <li key={beat.id}>
                <strong>{beat.title || "Untitled idea"}</strong>
                <div className="row" style={{ gap: "0.5rem", flexWrap: "wrap", marginTop: "0.35rem" }}>
                  <Select
                    label="Action"
                    value={draft.mode}
                    onChange={(event) => {
                      const mode = event.target.value as DraftChoice["mode"];
                      setDrafts((current) => ({ ...current, [beat.id]: { ...draft, mode } }));
                    }}
                  >
                    <option value="skip">{WEAVE.planChaptersSkip}</option>
                    <option value="link" disabled={!manuscriptChoices.length}>
                      {WEAVE.planChaptersLink}
                    </option>
                    <option value="create">{WEAVE.planChaptersCreate}</option>
                  </Select>
                  {draft.mode === "link" ? (
                    <Select
                      label="Chapter or scene"
                      value={draft.recordId}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [beat.id]: { ...draft, recordId: event.target.value },
                        }))
                      }
                    >
                      {manuscriptChoices.map((choice) => (
                        <option key={choice.id} value={choice.id}>
                          {choice.title} ({choice.typeLabel})
                        </option>
                      ))}
                    </Select>
                  ) : null}
                  {draft.mode === "create" ? (
                    <TextField
                      label="Chapter title"
                      value={draft.title}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [beat.id]: { ...draft, title: event.target.value },
                        }))
                      }
                    />
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <ul className="weave-plan-chapters-list">
          {planned.map((draft) => (
            <li key={draft.beatId}>
              {draft.mode === "link"
                ? `Link “${unlinked.find((b) => b.id === draft.beatId)?.title ?? "idea"}” → ${
                    manuscriptChoices.find((c) => c.id === draft.recordId)?.title ?? draft.recordId
                  }`
                : `Create blank chapter “${draft.title.trim() || "Chapter"}” for “${
                    unlinked.find((b) => b.id === draft.beatId)?.title ?? "idea"
                  }”`}
            </li>
          ))}
        </ul>
      )}

      <div className="row" style={{ gap: "0.5rem", flexWrap: "wrap", marginTop: "0.75rem" }}>
        {!review ? (
          <Button type="button" size="sm" disabled={!planned.length} onClick={() => setReview(true)}>
            {WEAVE.planChaptersReview}
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            disabled={pending || !planned.length}
            onClick={() =>
              startTransition(async () => {
                const ops: WeavePlanChapterOp[] = planned.map((draft) =>
                  draft.mode === "link"
                    ? { beatId: draft.beatId, action: "link", recordId: draft.recordId }
                    : {
                        beatId: draft.beatId,
                        action: "create",
                        title: draft.title,
                        draftId: draftId ?? null,
                      },
                );
                const result = await applyWeavePlanChapterMappingsAction(projectId, gridId, ops);
                if (!result.ok) {
                  setIssues(result.issues);
                  return;
                }
                setIssues([]);
                router.refresh();
                onClose();
              })
            }
          >
            {pending ? WEAVE.structuresAdding : WEAVE.planChaptersReview}
          </Button>
        )}
        {review ? (
          <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setReview(false)}>
            Back
          </Button>
        ) : null}
        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={onClose}>
          Cancel
        </Button>
      </div>
    </section>
  );
}
