"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { ButtonLink } from "@/components/ui/Button";
import { IssueList } from "@/components/IssueList";
import type { Issue } from "@/domain/issues";
import { WORLD } from "@/ui/labels";
import { createWorldMapAction, createWorldMapUploadAction } from "./actions";

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
  const [title, setTitle] = useState("");
  const [source, setSource] = useState<"upload" | "existing">(images.length ? "existing" : "upload");
  const [imageId, setImageId] = useState(images[0]?.id ?? "");
  const [hostId, setHostId] = useState(hosts[0]?.id ?? "");
  const [confirmProtected, setConfirmProtected] = useState(false);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [pending, startTransition] = useTransition();
  const worldHref = `/projects/${encodeURIComponent(projectId)}/world`;
  const host = hosts.find((item) => item.id === hostId) ?? null;

  if (hosts.length === 0 && images.length === 0) {
    return (
      <div className="stack">
        <p className="muted" style={{ margin: 0 }}>
          {WORLD.mapsNeedImage}
        </p>
        <ButtonLink href={worldHref}>{WORLD.mapsBrowseWorld}</ButtonLink>
      </div>
    );
  }

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        setIssues([]);
        startTransition(async () => {
          if (source === "existing") {
            const result = await createWorldMapAction(projectId, { title, imageId });
            if (!result.ok) {
              setIssues(result.issues);
              return;
            }
            router.push(`/projects/${encodeURIComponent(projectId)}/world/maps/${encodeURIComponent(result.mapId)}`);
            return;
          }
          const file = fileRef.current?.files?.[0];
          const body = new FormData();
          body.set("title", title);
          body.set("recordId", hostId);
          if (confirmProtected) body.set("confirmProtected", "on");
          if (file) body.set("file", file);
          const result = await createWorldMapUploadAction(projectId, body);
          if (!result.ok) {
            setIssues(result.issues);
            return;
          }
          router.push(`/projects/${encodeURIComponent(projectId)}/world/maps/${encodeURIComponent(result.mapId)}`);
        });
      }}
    >
      <label>
        {WORLD.mapTitle}
        <input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} />
      </label>
      <fieldset className="stack">
        <legend>{WORLD.mapImage}</legend>
        <label className="map-source-choice">
          <input
            type="radio"
            name="map-source"
            checked={source === "upload"}
            onChange={() => setSource("upload")}
          />
          {WORLD.mapSourceUpload}
        </label>
        <label className="map-source-choice">
          <input
            type="radio"
            name="map-source"
            checked={source === "existing"}
            onChange={() => setSource("existing")}
            disabled={images.length === 0}
          />
          {WORLD.mapSourceExisting}
        </label>
      </fieldset>
      {source === "existing" ? (
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
      ) : (
        <>
          <label>
            {WORLD.mapSourceUpload}
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" required />
          </label>
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
            <label className="row">
              <input
                type="checkbox"
                checked={confirmProtected}
                onChange={(e) => setConfirmProtected(e.target.checked)}
              />
              {WORLD.mapProtectedConfirm(host.title)}
            </label>
          ) : null}
        </>
      )}
      <IssueList issues={issues} />
      <button type="submit" disabled={pending || (source === "existing" ? !imageId : !hostId)}>
        {WORLD.createMap}
      </button>
    </form>
  );
}
