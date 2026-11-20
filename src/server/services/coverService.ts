import { newId } from "@/domain/ids";
import { errorIssue, type Issue } from "@/domain/issues";
import { sha256Bytes } from "@/domain/json";
import { Prisma } from "@/generated/prisma/client";
import { formatBytes, isImageMimeType, MAX_IMAGE_BYTES, sniffImage, type ImageMimeType } from "@/images/imageFormat";
import type { Db, DbOrTx } from "../db";
import { writeAudit } from "./auditService";
import { MutationRejectedError, NotFoundError } from "./errors";
import { LIVE_PROJECT } from "./trashFilters";

/*
 * One cover picture per project. It is not manuscript content: setting or
 * clearing it creates no revision and never changes record text, so it does
 * not go through mutationService. Every change is audited.
 */

const UI_ACTOR = "author";

export interface ProjectCoverData {
  id: string;
  mimeType: ImageMimeType;
  contentHash: string;
  originalFilename: string;
  data: Uint8Array;
}

export function isCoverTableMissing(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021";
}

function rejected(code: Issue["code"], message: string): MutationRejectedError {
  return new MutationRejectedError([errorIssue(code, message)]);
}

/** Content hashes for live projects that have a cover. Empty when the table is not migrated yet. */
export async function listProjectCoverHashes(db: DbOrTx, projectIds: string[]): Promise<Map<string, string>> {
  if (!projectIds.length) return new Map();
  try {
    const rows = await db.projectCover.findMany({
      where: { projectId: { in: projectIds }, project: LIVE_PROJECT },
      select: { projectId: true, contentHash: true },
    });
    return new Map(rows.map((row) => [row.projectId, row.contentHash]));
  } catch (error) {
    if (isCoverTableMissing(error)) return new Map();
    throw error;
  }
}

/** Cover bytes for a live project. Null when the project uses the drawn cover. */
export async function getProjectCoverData(db: DbOrTx, projectId: string): Promise<ProjectCoverData | null> {
  const row = await db.projectCover.findFirst({
    where: { projectId, project: LIVE_PROJECT },
    select: { id: true, mimeType: true, contentHash: true, originalFilename: true, data: true },
  });
  if (!row || !isImageMimeType(row.mimeType)) return null;
  return { ...row, mimeType: row.mimeType, data: new Uint8Array(row.data) };
}

export async function setProjectCover(
  db: Db,
  input: { projectId: string; filename: string; bytes: Uint8Array; actor?: string },
): Promise<{ contentHash: string }> {
  const bytes = input.bytes;
  if (bytes.byteLength === 0) throw rejected("IMAGE_INVALID", "The cover image is empty.");
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw rejected(
      "IMAGE_INVALID",
      `That image is ${formatBytes(bytes.byteLength)}. A cover can be up to ${formatBytes(MAX_IMAGE_BYTES)}.`,
    );
  }
  const info = sniffImage(bytes);
  if (!info) throw rejected("IMAGE_INVALID", "That file is not a PNG, JPEG, GIF or WebP image.");
  const contentHash = sha256Bytes(bytes);
  const originalFilename = input.filename.replace(/[/\\]/g, " ").trim().slice(0, 255) || "cover";
  const actor = input.actor ?? UI_ACTOR;

  await db.$transaction(async (tx) => {
    const project = await tx.project.findFirst({
      where: { id: input.projectId, ...LIVE_PROJECT },
      select: { id: true, title: true },
    });
    if (!project) throw new NotFoundError(`Project ${input.projectId} not found`);
    const existing = await tx.projectCover.findUnique({ where: { projectId: project.id }, select: { id: true } });
    const data = {
      originalFilename,
      mimeType: info.mimeType,
      byteSize: bytes.byteLength,
      width: info.width,
      height: info.height,
      contentHash,
      data: Buffer.from(bytes),
    };
    if (existing) await tx.projectCover.update({ where: { projectId: project.id }, data });
    else await tx.projectCover.create({ data: { id: newId("cvr"), projectId: project.id, ...data } });
    await writeAudit(tx, {
      projectId: project.id,
      action: existing ? "project.cover.replace" : "project.cover.set",
      actor,
      summary: `Set the cover image for "${project.title}"`,
      details: { contentHash, mimeType: info.mimeType, byteSize: bytes.byteLength, width: info.width, height: info.height },
    });
  });
  return { contentHash };
}

/** Removes a stored cover so the home page draws one again. Does nothing when none is stored. */
export async function clearProjectCover(db: Db, input: { projectId: string; actor?: string }): Promise<void> {
  const actor = input.actor ?? UI_ACTOR;
  await db.$transaction(async (tx) => {
    const project = await tx.project.findFirst({
      where: { id: input.projectId, ...LIVE_PROJECT },
      select: { id: true, title: true },
    });
    if (!project) throw new NotFoundError(`Project ${input.projectId} not found`);
    const existing = await tx.projectCover.findUnique({
      where: { projectId: project.id },
      select: { id: true, contentHash: true },
    });
    if (!existing) return;
    await tx.projectCover.delete({ where: { projectId: project.id } });
    await writeAudit(tx, {
      projectId: project.id,
      action: "project.cover.clear",
      actor,
      summary: `Removed the cover image for "${project.title}"`,
      details: { contentHash: existing.contentHash },
    });
  });
}
