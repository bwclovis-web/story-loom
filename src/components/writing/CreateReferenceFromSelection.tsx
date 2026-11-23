"use client";

import { useRef, useState } from "react";
import { createReferenceFromSelectionAction } from "@/app/projects/[projectId]/write/actions";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Atoms/Checkbox";
import { Banner } from "@/components/ui/Banner";
import { RECORD_TYPE_LABELS } from "@/domain/recordTypes";
import { WRITE } from "@/ui/labels";

const TYPES = ["research_note", "character_dossier", "worldbuilding", "continuity_note", "reference_note"] as const;

export function CreateReferenceFromSelection({
  projectId,
  fromRecordId,
  draftScopeId,
  selectionText,
  disabled,
}: {
  projectId: string;
  fromRecordId: string;
  draftScopeId: string | null;
  selectionText: string;
  disabled?: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [type, setType] = useState<(typeof TYPES)[number]>("research_note");
  const [link, setLink] = useState(true);
  const [pin, setPin] = useState(true);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const selected = selectionText.trim();

  const show = () => {
    const passage = selected;
    setBody(passage);
    setTitle(passage.slice(0, 80).replace(/\s+/g, " ").trim());
    setMessage(null);
    setError(null);
    setOpen(true);
    dialogRef.current?.showModal();
  };

  const hide = () => {
    dialogRef.current?.close();
    setOpen(false);
  };

  const submit = async () => {
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const result = await createReferenceFromSelectionAction(projectId, fromRecordId, {
        title,
        body,
        type,
        link,
        pin,
        draftScopeId,
      });
      if (!result.ok) {
        setError(result.issues?.map((i) => i.message).join(" ") ?? "Could not create the reference.");
        return;
      }
      setMessage(result.message ?? WRITE.createReferenceSubmit);
      hide();
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={disabled || !selected}
        onMouseDown={(e) => e.preventDefault()}
        onClick={show}
      >
        {WRITE.createReferenceFromSelection}
      </Button>
      {message ? <Banner tone="ok">{message}</Banner> : null}
      <dialog
        ref={dialogRef}
        className="panel"
        style={{ maxWidth: "28rem" }}
        onClose={() => setOpen(false)}
      >
        {open ? (
          <form
            method="dialog"
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <h2>{WRITE.createReferenceTitle}</h2>
            {error ? <Banner tone="error">{error}</Banner> : null}
            <label className="stack">
              <span className="small">Title</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} />
            </label>
            <label className="stack">
              <span className="small">Document type</span>
              <select value={type} onChange={(e) => setType(e.target.value as (typeof TYPES)[number])}>
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {RECORD_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </label>
            <Checkbox
              className="small"
              checked={link}
              onChange={(e) => setLink(e.target.checked)}
              label={WRITE.createReferenceLink}
            />
            <Checkbox
              className="small"
              checked={pin}
              onChange={(e) => setPin(e.target.checked)}
              label={WRITE.createReferencePin}
            />
            <p className="small muted" style={{ maxHeight: "8rem", overflow: "auto", whiteSpace: "pre-wrap" }}>
              {body}
            </p>
            <div className="row">
              <Button type="submit" size="sm" disabled={pending || !title.trim()}>
                {pending ? "Creating…" : WRITE.createReferenceSubmit}
              </Button>
              <Button type="button" size="sm" variant="secondary" onClick={hide}>
                Cancel
              </Button>
            </div>
          </form>
        ) : null}
      </dialog>
    </>
  );
}
