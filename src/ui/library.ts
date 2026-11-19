import { DEMO_WORKSPACE_ID } from "@/domain/demoIdentity";

/** Decorative fallbacks. Chosen from the project id, never from the title. */
export const COVER_MOTIFS = ["botanical", "waves", "lantern"] as const;
export type CoverMotif = (typeof COVER_MOTIFS)[number];

export function isExampleWorkspace(workspaceId: string): boolean {
  return workspaceId === DEMO_WORKSPACE_ID;
}

/** Stable motif for a project. The same id always maps to the same artwork. */
export function coverMotifForProject(projectId: string): CoverMotif {
  let hash = 2166136261;
  for (let i = 0; i < projectId.length; i++) {
    hash ^= projectId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return COVER_MOTIFS[(hash >>> 0) % COVER_MOTIFS.length];
}

/** Series name when the author set one; otherwise the workspace name. */
export function manuscriptEyebrow(seriesName: string | null | undefined, workspaceName: string): string {
  const series = seriesName?.trim();
  return series ? series : workspaceName;
}

/**
 * The manuscript to feature on the home page.
 * Uses the project this browser last opened when that project is still here.
 * Otherwise the first non-example project in the given order, then the first project.
 * `projects` must already be in a stable order (workspace creation, then project creation).
 */
export function pickFeaturedProject<T extends { id: string; workspaceId: string }>(
  projects: readonly T[],
  selectedId: string | null | undefined,
): T | null {
  if (projects.length === 0) return null;
  if (selectedId) {
    const selected = projects.find((project) => project.id === selectedId);
    if (selected) return selected;
  }
  return projects.find((project) => !isExampleWorkspace(project.workspaceId)) ?? projects[0];
}
