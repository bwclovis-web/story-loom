"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  setDefaultExportDraftAction,
  setDefaultReadingDraftAction,
  setDraftCompletionAction,
  startAuthorRewriteAction,
} from "@/app/projects/[projectId]/drafts/actions";
import { WRITE_DRAFT_COOKIE, writePreference } from "@/components/shell/preferences";
import type { DraftKind } from "@/domain/assignments";
import { DRAFT } from "@/ui/labels";

export interface DraftOption {
  id: string;
  kind: DraftKind;
  label: string;
  completedAt: string | null;
}

export function WriteDraftSwitcher({
  projectId,
  drafts,
  activeDraftId,
}: {
  projectId: string;
  drafts: DraftOption[];
  activeDraftId: string | null;
}) {
  const router = useRouter();
  if (drafts.length === 0) return null;
  return (
    <label className="draft-switcher">
      <span className="sr-only">{DRAFT.writeDraft}</span>
      <select
        value={activeDraftId ?? ""}
        aria-label={DRAFT.writeDraft}
        onChange={(e) => {
          const id = e.target.value;
          writePreference(WRITE_DRAFT_COOKIE, id);
          router.refresh();
        }}
      >
        {drafts.map((d) => (
          <option key={d.id} value={d.id}>
            {d.label}
            {d.completedAt ? " · complete" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

export function StartAuthorRewriteButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="stack draft-start">
      <p className="small muted">{DRAFT.startRewriteLead}</p>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null);
          setMessage(null);
          startTransition(async () => {
            const result = await startAuthorRewriteAction(projectId);
            if (!result.ok) {
              setError(result.issues.map((i) => i.message).join(" "));
              return;
            }
            writePreference(WRITE_DRAFT_COOKIE, result.result.authorDraft.id);
            setMessage(
              result.result.alreadyExisted
                ? DRAFT.alreadyStarted
                : DRAFT.started(result.result.createdRecordIds.length),
            );
            const open =
              result.result.openRecordId ??
              null;
            if (open) {
              router.push(`/projects/${encodeURIComponent(projectId)}/records/${encodeURIComponent(open)}`);
            } else {
              router.push(`/projects/${encodeURIComponent(projectId)}/write`);
              router.refresh();
            }
          });
        }}
      >
        {pending ? DRAFT.startingRewrite : DRAFT.startRewrite}
      </button>
      {message ? <p className="small">{message}</p> : null}
      {error ? <p className="issue error">{error}</p> : null}
    </div>
  );
}

export function DraftDefaultsPanel({
  projectId,
  drafts,
  selectedDraftId,
  defaultReadingDraftId,
  defaultExportDraftId,
  mode,
}: {
  projectId: string;
  drafts: DraftOption[];
  selectedDraftId: string | null;
  defaultReadingDraftId: string | null;
  defaultExportDraftId: string | null;
  mode: "reading" | "export";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  if (drafts.length === 0) return null;
  const selected = drafts.find((d) => d.id === selectedDraftId) ?? null;
  const defaultId = mode === "reading" ? defaultReadingDraftId : defaultExportDraftId;
  const isDefault = selected && defaultId === selected.id;

  return (
    <div className="row draft-defaults">
      <button
        type="button"
        className="secondary small-button"
        disabled={pending || !selected || !!isDefault}
        onClick={() => {
          if (!selected) return;
          startTransition(async () => {
            if (mode === "reading") await setDefaultReadingDraftAction(projectId, selected.id);
            else await setDefaultExportDraftAction(projectId, selected.id);
            router.refresh();
          });
        }}
      >
        {mode === "reading" ? DRAFT.setDefaultReading : DRAFT.setDefaultExport}
      </button>
      {defaultId ? (
        <button
          type="button"
          className="secondary small-button"
          disabled={pending}
          onClick={() => {
            startTransition(async () => {
              if (mode === "reading") await setDefaultReadingDraftAction(projectId, null);
              else await setDefaultExportDraftAction(projectId, null);
              router.refresh();
            });
          }}
        >
          {mode === "reading" ? DRAFT.clearDefaultReading : DRAFT.clearDefaultExport}
        </button>
      ) : null}
    </div>
  );
}

export function MarkRewriteCompleteButton({
  projectId,
  draftId,
  completed,
}: {
  projectId: string;
  draftId: string;
  completed: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      className="secondary small-button"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          await setDraftCompletionAction(projectId, draftId, !completed);
          router.refresh();
        });
      }}
    >
      {completed ? DRAFT.markIncomplete : DRAFT.markComplete}
    </button>
  );
}

/** Compact label for the active draft on Write, Assistant, and Export. */
export function DraftScopeChip({
  drafts,
  activeDraftId,
}: {
  drafts: DraftOption[];
  activeDraftId: string | null;
}) {
  if (drafts.length === 0) {
    return <p className="small muted draft-scope-chip">{DRAFT.legacyScope}</p>;
  }
  const active = drafts.find((d) => d.id === activeDraftId) ?? null;
  return (
    <p className="small draft-scope-chip" aria-label={DRAFT.draftLabel}>
      <span className="muted">{DRAFT.draftLabel}:</span> {active?.label ?? DRAFT.selectDraft}
      {active?.kind === "zero_draft" ? ` (${DRAFT.zeroDraft})` : null}
      {active?.kind === "author_manuscript" ? ` (${DRAFT.authorManuscript})` : null}
    </p>
  );
}

export function VisitDraftSwitcher({
  drafts,
  selectedDraftId,
  basePath,
  paramName = "draft",
  label,
}: {
  drafts: DraftOption[];
  selectedDraftId: string | null;
  basePath: string;
  paramName?: string;
  label: string;
}) {
  const router = useRouter();
  if (drafts.length === 0) return null;
  return (
    <label className="draft-switcher">
      <span className="small">{label}</span>
      <select
        value={selectedDraftId ?? ""}
        aria-label={label}
        onChange={(e) => {
          const id = e.target.value;
          const url = new URL(basePath, window.location.origin);
          if (id) url.searchParams.set(paramName, id);
          else url.searchParams.delete(paramName);
          router.push(url.pathname + url.search);
        }}
      >
        <option value="">{DRAFT.selectDraft}</option>
        {drafts.map((d) => (
          <option key={d.id} value={d.id}>
            {d.label}
          </option>
        ))}
      </select>
    </label>
  );
}
