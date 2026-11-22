"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import type { RecordView } from "@/domain/records";
import { IssueList } from "@/components/IssueList";
import { HelpHint } from "@/components/HelpHint";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { RECORD_TYPE_LABELS } from "@/domain/recordTypes";
import type { RecordRenameMatch, RecordRenamePreview } from "@/server/services/recordRenameService";
import { aliasesOf, nameFromTitle } from "@/writing/crossRefs";
import { RECORD, RECORD_RENAME } from "@/ui/labels";
import { applyRecordRenameAction, previewRecordRenameAction, type RenameResult } from "./rename-actions";

function defaultName(record: RecordView): string {
  const fromField = record.fields.name;
  if (typeof fromField === "string" && fromField.trim()) return fromField.trim();
  return nameFromTitle(record.title) ?? "";
}

function groupMatches(matches: readonly RecordRenameMatch[]) {
  const map = new Map<string, RecordRenameMatch[]>();
  for (const m of matches) map.set(m.recordId, [...(map.get(m.recordId) ?? []), m]);
  return map;
}

function Review({
  projectId,
  record,
  preview,
  base,
}: {
  projectId: string;
  record: RecordView;
  preview: RecordRenamePreview;
  base: string;
}) {
  const grouped = groupMatches(preview.matches);
  const defaultSelected = useMemo(
    () => new Set(preview.matches.filter((m) => !m.ambiguous).map((m) => m.id)),
    [preview.matches],
  );
  const [selected, setSelected] = useState(() => new Set(defaultSelected));
  const needsUnlock = record.protected || preview.matches.some((m) => m.protected && selected.has(m.id));
  const [state, formAction, pending] = useActionState(applyRecordRenameAction.bind(null, projectId, record.id), {
    ok: true,
  } satisfies RenameResult);
  const selectedCount = preview.matches.filter((m) => selected.has(m.id)).length;
  const aliasText = Array.isArray(preview.newFields.aliases)
    ? preview.newFields.aliases.filter((a): a is string => typeof a === "string").join("\n")
    : "";

  const toggle = (id: string, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  return (
    <section className="panel stack" aria-labelledby="record-rename-review">
      <h3 id="record-rename-review">{RECORD_RENAME.reviewHeading}</h3>
      {preview.titleChanges || preview.fieldsChange ? (
        <p className="small">
          {RECORD_RENAME.referenceWillUpdate}
          {preview.titleChanges ? (
            <>
              {" "}
              {RECORD_RENAME.titleField}: <del>{record.title}</del> → <ins>{preview.newTitle}</ins>
            </>
          ) : null}
        </p>
      ) : (
        <p className="small muted">{RECORD_RENAME.referenceUnchanged}</p>
      )}
      <p className="small muted">{RECORD_RENAME.reviewLead(selectedCount, preview.matches.length)}</p>

      <form action={formAction} className="stack">
        <input type="hidden" name="newTitle" value={preview.newTitle} />
        <input type="hidden" name="newName" value={typeof preview.newFields.name === "string" ? preview.newFields.name : ""} />
        <input type="hidden" name="newAliases" value={aliasText} />
        <input type="hidden" name="recordRevision" value={String(record.currentRevision)} />
        {[...grouped.entries()].map(([recordId, matches]) => (
          <input key={recordId} type="hidden" name={`rev_${recordId}`} value={String(matches[0]!.expectedRevision)} />
        ))}

        {preview.matches.length === 0 ? <p className="muted">{RECORD_RENAME.noManuscriptMatches}</p> : null}
        <ul className="search-hits">
          {[...grouped.entries()].map(([recordId, matches]) => (
            <li key={recordId}>
              <div className="row">
                <Link href={`${base}/records/${encodeURIComponent(recordId)}`} className="hit-title">
                  {matches[0]!.recordTitle}
                </Link>
                <span className="small muted">{RECORD_TYPE_LABELS[matches[0]!.recordType]}</span>
              </div>
              <ul className="hit-excerpts small">
                {matches.map((m) => (
                  <li key={m.id}>
                    <Checkbox
                      name="matchId"
                      value={m.id}
                      checked={selected.has(m.id)}
                      onChange={(e) => toggle(m.id, e.target.checked)}
                      label={
                        <span className="muted">
                          {RECORD_RENAME.formLine(m.form, m.replacement)}
                          {m.ambiguous ? ` (${RECORD_RENAME.ambiguous})` : ""}
                        </span>
                      }
                    />
                    <div className="small">
                      <del>{m.excerptBefore}</del>
                      <ins>{m.excerptAfter}</ins>
                    </div>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>

        {needsUnlock ? (
          <Checkbox className="small" name="unlockProtected" required disabled={pending} label={RECORD.unlockProtected} />
        ) : null}

        <Button type="submit" disabled={pending || (!preview.titleChanges && !preview.fieldsChange && selectedCount === 0)}>
          {pending ? RECORD_RENAME.applying : RECORD_RENAME.apply}
        </Button>
        {state.message ? (
          <Banner tone={state.ok ? "ok" : "error"} className="mb-0">
            {state.message}
          </Banner>
        ) : null}
        <IssueList issues={state.issues ?? []} />
      </form>
    </section>
  );
}

export function RecordRenameSection({ projectId, record }: { projectId: string; record: RecordView }) {
  const [previewState, previewAction, previewPending] = useActionState(previewRecordRenameAction.bind(null, projectId, record.id), {
    ok: true,
  } satisfies RenameResult);
  const aliasesText = aliasesOf(record.fields).join("\n");

  return (
    <section className="panel" id="rename-everywhere">
      <h2>{RECORD_RENAME.heading}</h2>
      <p className="small muted">{RECORD_RENAME.lead}</p>
      <HelpHint anchor="record-rename" topic="rename everywhere">
        Ambiguous matches are unticked by default so a shared first name is not changed unless you choose it.
      </HelpHint>

      <form className="stack" action={previewAction}>
        <label>
          {RECORD_RENAME.titleField}
          <input name="newTitle" type="text" defaultValue={record.title} required />
        </label>
        <label>
          {RECORD_RENAME.nameField}
          <input name="newName" type="text" defaultValue={defaultName(record)} />
        </label>
        <label>
          {RECORD_RENAME.aliasesField}
          <textarea name="newAliases" rows={3} defaultValue={aliasesText} />
        </label>
        <Button type="submit" disabled={previewPending}>
          {previewPending ? RECORD_RENAME.previewing : RECORD_RENAME.preview}
        </Button>
        <IssueList issues={previewState.issues ?? []} />
      </form>

      {previewState.preview ? (
        <Review projectId={projectId} record={record} preview={previewState.preview} base={`/projects/${encodeURIComponent(projectId)}`} />
      ) : null}
    </section>
  );
}