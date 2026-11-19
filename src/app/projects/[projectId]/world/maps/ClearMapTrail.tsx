"use client";

import { useEffect } from "react";
import { clearMapTrail } from "@/world/mapMarkers";

/** The maps index is a fresh start, so a later map does not inherit an old path. */
export function ClearMapTrail({ projectId }: { projectId: string }) {
  useEffect(() => {
    clearMapTrail(projectId);
  }, [projectId]);
  return null;
}
