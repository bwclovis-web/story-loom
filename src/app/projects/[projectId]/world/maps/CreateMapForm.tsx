"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { IssueList } from "@/components/IssueList";
import type { Issue } from "@/domain/issues";
import { WORLD } from "@/ui/labels";
import { createWorldMapAction } from "./actions";

export function CreateMapForm({
  projectId,
  images,
}: {
  projectId: string;
  images: Array<{ id: string; label: string }>;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [imageId, setImageId] = useState(images[0]?.id ?? "");
  const [issues, setIssues] = useState<Issue[]>([]);
  const [pending, startTransition] = useTransition();

  if (images.length === 0) {
    return <p className="muted">{WORLD.noMaps}</p>;
  }

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        setIssues([]);
        startTransition(async () => {
          const result = await createWorldMapAction(projectId, { title, imageId });
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
      <IssueList issues={issues} />
      <button type="submit" disabled={pending || !imageId}>
        {WORLD.createMap}
      </button>
    </form>
  );
}
