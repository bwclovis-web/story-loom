/** Prisma filter for projects that are not in the Trash themselves or through their workspace. */
export const LIVE_PROJECT = { trashedAt: null, workspace: { trashedAt: null } } as const;

/** Prisma filter for records that are not in the Trash themselves or through their project or workspace. */
export const LIVE_RECORD = { trashedAt: null, project: LIVE_PROJECT } as const;
