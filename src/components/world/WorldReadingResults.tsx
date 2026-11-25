"use client";

import { useEffect, useId, useState } from "react";
import { WorldReadingCard } from "@/components/world/WorldReadingCard";
import { WorldReferencePreview } from "@/components/world/WorldReferencePreview";
import type { WorldHubRecord } from "@/world/hubDiscovery";
import type { CustomTaxonomyCategoryOption } from "@/world/customCategories";

export function WorldReadingResults({
  projectId,
  records,
  imageByRecordId,
  seriesName = null,
  customCategories = [],
}: {
  projectId: string;
  records: WorldHubRecord[];
  imageByRecordId: Record<string, string>;
  seriesName?: string | null;
  customCategories?: readonly CustomTaxonomyCategoryOption[];
}) {
  const [previewId, setPreviewId] = useState<string | null>(null);
  const panelId = useId();
  const preview = previewId ? records.find((row) => row.id === previewId) ?? null : null;

  useEffect(() => {
    if (previewId && !records.some((row) => row.id === previewId)) {
      setPreviewId(null);
    }
  }, [previewId, records]);

  useEffect(() => {
    if (!preview) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreviewId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [preview]);

  return (
    <div className={`world-reading-results${preview ? " has-preview" : ""}`}>
      <ul className="world-reading-card-grid">
        {records.map((record) => (
          <li key={record.id}>
            <WorldReadingCard
              projectId={projectId}
              record={record}
              imageSrc={imageByRecordId[record.id] ?? null}
              seriesName={seriesName}
              customCategories={customCategories}
              selected={previewId === record.id}
              onPreview={() => setPreviewId(record.id)}
            />
          </li>
        ))}
      </ul>
      {preview ? (
        <div className="world-reading-preview-slot" id={panelId}>
          <WorldReferencePreview
            projectId={projectId}
            record={preview}
            imageSrc={imageByRecordId[preview.id] ?? null}
            seriesName={seriesName}
            onClose={() => setPreviewId(null)}
          />
        </div>
      ) : null}
    </div>
  );
}
