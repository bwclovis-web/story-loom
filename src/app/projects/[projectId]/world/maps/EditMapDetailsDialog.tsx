"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Atoms/Button";
import { Select } from "@/components/ui/Atoms/Select";
import { IssueList } from "@/components/IssueList";
import { TextField } from "@/components/ui/TextField";
import { errorIssue, type Issue } from "@/domain/issues";
import { REFERENCE_FORM, WORLD } from "@/ui/labels";
import { MAP_CLASSIFICATION_LABEL, MAP_CLASSIFICATIONS } from "@/world/mapClassification";
import type { MapLibraryItem } from "@/world/mapLibrary";
import { updateWorldMapDetailsAction } from "./actions";

export function EditMapDetailsDialog({
  projectId,
  map,
  open,
  onClose,
}: {
  projectId: string;
  map: MapLibraryItem | null;
  open: boolean;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [classification, setClassification] = useState("");
  const [issues, setIssues] = useState<Issue[]>([]);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!map) return;
    setTitle(map.title);
    setClassification(map.classification ?? "");
    setIssues([]);
  }, [map]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && map) {
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [open, map]);

  return (
    <dialog
      ref={dialogRef}
      className="library-dialog map-library-dialog"
      aria-labelledby={titleId}
      onClose={onClose}
    >
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (!map || pending) return;
          if (!title.trim()) {
            setIssues([errorIssue("INVALID_REFERENCE", "Give the map a title.")]);
            return;
          }
          setIssues([]);
          startTransition(async () => {
            const result = await updateWorldMapDetailsAction(projectId, map.id, {
              title,
              classification,
            });
            if (!result.ok) {
              setIssues(result.issues);
              return;
            }
            onClose();
            router.refresh();
          });
        }}
      >
        <h2 id={titleId}>{WORLD.mapEditDetails}</h2>
        <TextField
          label={WORLD.mapTitle}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          maxLength={200}
        />
        <Select
          label={WORLD.mapClassification}
          value={classification}
          onChange={(e) => setClassification(e.target.value)}
          hint={WORLD.mapsSetTypeHint}
        >
          <option value="">{WORLD.mapClassificationNone}</option>
          {MAP_CLASSIFICATIONS.map((value) => (
            <option key={value} value={value}>
              {MAP_CLASSIFICATION_LABEL[value]}
            </option>
          ))}
        </Select>
        <IssueList issues={issues} />
        <div className="row" style={{ justifyContent: "flex-end", gap: "0.5rem" }}>
          <Button type="button" variant="secondary" disabled={pending} onClick={onClose}>
            {REFERENCE_FORM.cancel}
          </Button>
          <Button type="submit" disabled={pending}>
            {WORLD.mapSaveDetails}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
