"use client";

import Link from "next/link";
import { useState } from "react";
import { MarkdownEditor } from "@/components/writing/MarkdownEditor";
import { WriteProtectionRow } from "@/components/writing/WriteProtectionRow";
import type { DraftOption } from "@/components/drafts/DraftControls";
import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Atoms/Button";
import { normalizeNewlines } from "@/proofread/anchors";
import { autosaveRecordAction, saveRecordAction } from "@/app/projects/[projectId]/actions";
import { WRITE } from "@/ui/labels";
import { useAutosave } from "@/writing/useAutosave";

export type ScriveningsRecord = {
  id: string;
  title: string;
  body: string;
  fieldsJson: string;
  revision: number;
  protected: boolean;
  kind: "chapter" | "scene";
};

export function ScriveningsScene({
  projectId,
  record,
  drafts,
  draftScopeId,
}: {
  projectId: string;
  record: ScriveningsRecord;
  drafts: DraftOption[];
  draftScopeId: string | null;
}) {
  const saved = normalizeNewlines(record.body);
  const [text, setText] = useState(saved);
  const [revision, setRevision] = useState(record.revision);
  const [baseline, setBaseline] = useState(saved);
  const [unlocked, setUnlocked] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const editable = !record.protected || unlocked;
  const dirty = text !== baseline;
  const base = `/projects/${encodeURIComponent(projectId)}/records/${encodeURIComponent(record.id)}`;

  const autosave = useAutosave({
    enabled: !record.protected,
    dirty,
    revision,
    title: record.title,
    body: text,
    fields: record.fieldsJson,
    save: (payload) => autosaveRecordAction(projectId, record.id, payload),
    onRevision: (next) => {
      setRevision(next);
      setBaseline(text);
    },
  });

  const save = async () => {
    setPending(true);
    setMessage(null);
    try {
      const form = new FormData();
      form.set("expectedRevision", String(revision));
      form.set("title", record.title);
      form.set("body", text);
      form.set("fields", record.fieldsJson);
      if (unlocked) form.set("unlockProtected", "on");
      const result = await saveRecordAction(projectId, record.id, { ok: true }, form);
      if (result.ok && result.revision) {
        setRevision(result.revision);
        setBaseline(text);
        setMessage(WRITE.savedRevision(result.revision));
      } else {
        setMessage(result.message ?? WRITE.notSaved);
      }
    } finally {
      setPending(false);
    }
  };

  const status =
    pending || autosave.status === "saving" || autosave.status === "scheduled"
      ? WRITE.autosaving
      : dirty
        ? WRITE.unsaved
        : autosave.status === "saved"
          ? WRITE.autosaved
          : WRITE.savedRevision(revision);

  return (
    <section className="scrivenings-scene panel" aria-labelledby={`scrivenings-${record.id}`}>
      <header className="scrivenings-scene-head">
        <h2 id={`scrivenings-${record.id}`}>
          <Link href={base}>{record.title}</Link>
        </h2>
        <p className="small muted" role="status">
          {status}
        </p>
      </header>
      <WriteProtectionRow
        drafts={drafts}
        activeDraftId={draftScopeId}
        isProtected={record.protected}
        unlocked={unlocked}
        onUnlocked={setUnlocked}
      />
      {message ? <Banner tone={dirty ? "info" : "ok"}>{message}</Banner> : null}
      <MarkdownEditor
        initialDoc={saved}
        editable={editable}
        chrome="live"
        aria-label={record.title}
        onChange={(next) => setText(normalizeNewlines(next))}
      />
      {record.protected ? (
        <div className="row" style={{ marginTop: "0.75rem" }}>
          <Button type="button" size="sm" disabled={!editable || !dirty || pending} onClick={() => void save()}>
            {pending ? WRITE.saving : WRITE.save}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
