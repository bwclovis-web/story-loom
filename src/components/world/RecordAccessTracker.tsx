"use client";

import { useEffect } from "react";
import { rememberRecentAccess } from "@/world/recentAccess";

/** Records that a World reference was opened. Keeps GET pages free of writes. */
export function RecordAccessTracker({
  projectId,
  recordId,
  title,
  isWorld,
}: {
  projectId: string;
  recordId: string;
  title: string;
  isWorld: boolean;
}) {
  useEffect(() => {
    if (!isWorld) return;
    rememberRecentAccess(projectId, { id: recordId, title });
  }, [projectId, recordId, title, isWorld]);
  return null;
}
