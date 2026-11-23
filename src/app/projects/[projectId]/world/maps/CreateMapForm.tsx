"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Atoms/Checkbox";
import { FileInput } from "@/components/ui/FileInput";
import { RadioGroup } from "@/components/ui/RadioGroup";
import { IssueList } from "@/components/IssueList";
import { errorIssue, type Issue } from "@/domain/issues";
import { AUTHORITY_STATUSES, isAuthorityStatus, type AuthorityStatus } from "@/domain/statuses";
import { REFERENCE_FORM, WORLD } from "@/ui/labels";
import { isMapReferenceType, MAP_REFERENCE_TYPES, type MapReferenceType } from "@/world/mapReference";
import { createWorldMapAction, createWorldMapUploadAction, createWorldMapWithNewReferenceAction } from "./actions";

const TYPE_LABEL: Record<MapReferenceType, string> = {
  character_dossier: REFERENCE_FORM.typeCharacter,
  worldbuilding: REFERENCE_FORM.typeWorldbuilding,
  rules_glossary: REFERENCE_FORM.typeRules,
  research_note: REFERENCE_FORM.typeResearch,
};

export function CreateMapForm({
  projectId,
  images,
  hosts,
}: {
  projectId: string;
  images: Array<{ id: string; label: string }>;
  hosts: Array<{ id: string; title: string; isProtected: boolean }>;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const lock = useRef(false);
  const [formKey, setFormKey] = useState(0);
  const [title, setTitle] = useState("");
  const [source, setSource] = useState<"upload" | "existing">(images.length ? "existing" : "upload");
  const [imageId, setImageId] = useState(images[0]?.id ?? "");
  const [hostMode, setHostMode] = useState<"existing" | "new">(hosts.length ? "existing" : "new");
  const [hostId, setHostId] = useState(hosts[0]?.id ?? "");
  const [confirmProtected, setConfirmProtected] = useState(false);
  const [referenceTitle, setReferenceTitle] = useState("");
  const [referenceType, setReferenceType] = useState<MapReferenceType>("worldbuilding");
  const [authorityStatus, setAuthorityStatus] = useState<AuthorityStatus>("draft");
  const [issues, setIssues] = useState<Issue[]>([]);
  const [pending, startTransition] = useTransition();
  const host = hosts.find((item) => item.id === hostId) ?? null;
  const creatingReference = source === "upload" && hostMode === "new";

  const reset = () => {
    setTitle("");
    setSource(images.length ? "existing" : "upload");
    setImageId(images[0]?.id ?? "");
    setHostMode(hosts.length ? "existing" : "new");
    setHostId(hosts[0]?.id ?? "");
    setConfirmProtected(false);
    setReferenceTitle("");
    setReferenceType("worldbuilding");
    setAuthorityStatus("draft");
    setIssues([]);
    if (fileRef.current) fileRef.current.value = "";
    setFormKey((key) => key + 1);
  };

  const previewTitle = title.trim() || WORLD.mapPreviewTitle;

  return (
    <div className="world-create-shell">
    <form
      key={formKey}
      className="world-create-form stack"
      aria-busy={pending}
      onSubmit={(e) => {
        e.preventDefault();
        if (lock.current || pending) return;
        const problems: Issue[] = [];
        if (!title.trim()) problems.push(errorIssue("INVALID_REFERENCE", "Give the map a title."));
        if (source === "existing" && !imageId) {
          problems.push(errorIssue("INVALID_REFERENCE", "Choose an image."));
        }
        const file = fileRef.current?.files?.[0];
        if (source === "upload" && (!file || file.size === 0)) {
          problems.push(errorIssue("IMAGE_INVALID", "Choose an image to upload."));
        }
        if (source === "upload" && hostMode === "existing" && !hostId) {
          problems.push(errorIssue("INVALID_REFERENCE", WORLD.mapNoHostYet));
        }
        if (source === "upload" && hostMode === "existing" && host?.isProtected && !confirmProtected) {
          problems.push(errorIssue("PROTECTED_CONFIRMATION_REQUIRED", WORLD.mapProtectedConfirm(host.title)));
        }
        if (creatingReference && !referenceTitle.trim()) {
          problems.push(errorIssue("INVALID_REFERENCE", "Give the reference a title."));
        }
        if (problems.length) {
          setIssues(problems);
          return;
        }
        lock.current = true;
        setIssues([]);
        startTransition(async () => {
          try {
            if (source === "existing") {
              const result = await createWorldMapAction(projectId, { title, imageId });
              if (!result.ok) {
                setIssues(result.issues);
                return;
              }
              router.push(`/projects/${encodeURIComponent(projectId)}/world/maps/${encodeURIComponent(result.mapId)}`);
              return;
            }
            const body = new FormData();
            body.set("title", title);
            if (file) body.set("file", file);
            const result = creatingReference
              ? await (async () => {
                  body.set("referenceTitle", referenceTitle);
                  body.set("type", referenceType);
                  body.set("authorityStatus", authorityStatus);
                  return createWorldMapWithNewReferenceAction(projectId, body);
                })()
              : await (async () => {
                  body.set("recordId", hostId);
                  if (confirmProtected) body.set("confirmProtected", "on");
                  return createWorldMapUploadAction(projectId, body);
                })();
            if (!result.ok) {
              setIssues(result.issues);
              return;
            }
            router.push(`/projects/${encodeURIComponent(projectId)}/world/maps/${encodeURIComponent(result.mapId)}`);
          } finally {
            lock.current = false;
          }
        });
      }}
    >
      <label className="world-create-field">
        {WORLD.mapTitle}
        <input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} />
      </label>
      <RadioGroup
        layout="stack"
        legend={WORLD.mapImage}
        name="map-source"
        value={source}
        onValueChange={(value) => {
          if (value === "upload" || value === "existing") setSource(value);
        }}
        options={[
          { value: "upload", label: WORLD.mapSourceUpload },
          { value: "existing", label: WORLD.mapSourceExisting, disabled: images.length === 0 },
        ]}
      />
      {source === "existing" ? (
        <>
          <label>
            {WORLD.mapImage}
            <select value={imageId} onChange={(e) => setImageId(e.target.value)} required>
              <option value="">{WORLD.chooseMapImage}</option>
              {images.map((img) => (
                <option key={img.id} value={img.id}>
                  {img.label}
                </option>
              ))}
            </select>
          </label>
          <p className="small muted">{WORLD.mapExistingImageStays}</p>
        </>
      ) : (
        <>
          <div className="world-create-dropzone">
            <FileInput ref={fileRef} label={WORLD.mapSourceUpload} accept="image/png,image/jpeg,image/gif,image/webp" />
          </div>
          <RadioGroup
            layout="stack"
            legend={WORLD.mapSaveWithReference}
            name="map-host"
            value={hostMode}
            hint={hosts.length === 0 ? WORLD.mapNoHostYet : undefined}
            onValueChange={(value) => {
              if (value === "existing" && hosts.length === 0) return;
              if (value === "existing" || value === "new") {
                setHostMode(value);
                setConfirmProtected(false);
              }
            }}
            options={[
              { value: "existing", label: WORLD.mapUseExistingReference, disabled: hosts.length === 0 },
              { value: "new", label: WORLD.mapCreateNewReference },
            ]}
          />
          <p className="small muted">{WORLD.mapReferenceStoresImage}</p>
          {hostMode === "existing" ? (
            <>
              <label>
                {WORLD.mapHostRecord}
                <select
                  value={hostId}
                  onChange={(e) => {
                    setHostId(e.target.value);
                    setConfirmProtected(false);
                  }}
                  required
                >
                  <option value="">{WORLD.chooseMapHost}</option>
                  {hosts.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
                </select>
              </label>
              {host?.isProtected ? (
                <Checkbox
                  checked={confirmProtected}
                  onChange={(e) => setConfirmProtected(e.target.checked)}
                  label={WORLD.mapProtectedConfirm(host.title)}
                />
              ) : null}
            </>
          ) : (
            <>
              <label>
                {WORLD.mapNewReferenceTitle}
                <input
                  value={referenceTitle}
                  onChange={(e) => setReferenceTitle(e.target.value)}
                  required
                  maxLength={200}
                />
              </label>
              <RadioGroup
                layout="row"
                legend={REFERENCE_FORM.documentType}
                name="map-reference-type"
                value={referenceType}
                onValueChange={(value) => {
                  if (isMapReferenceType(value)) setReferenceType(value);
                }}
                options={MAP_REFERENCE_TYPES.map((type) => ({ value: type, label: TYPE_LABEL[type] }))}
              />
              <label>
                {REFERENCE_FORM.canonStatus}
                <select
                  value={authorityStatus}
                  onChange={(e) => {
                    if (isAuthorityStatus(e.target.value)) setAuthorityStatus(e.target.value);
                  }}
                >
                  {AUTHORITY_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status.charAt(0).toUpperCase() + status.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
              <p className="small muted">{REFERENCE_FORM.draftHint}</p>
            </>
          )}
        </>
      )}
      <IssueList issues={issues} />
      <div className="world-create-actions">
        <Button type="button" variant="secondary" disabled={pending} onClick={reset}>
          {REFERENCE_FORM.cancel}
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? (creatingReference ? WORLD.mapCreatingBoth : WORLD.mapCreating) : creatingReference ? WORLD.createReferenceAndMap : WORLD.createMap}
        </Button>
      </div>
    </form>

    <aside className="world-create-preview map-create-preview" aria-hidden="true">
      <p className="world-create-preview-label">{previewTitle}</p>
      <div className="map-create-preview-canvas" />
    </aside>
    </div>
  );
}
