import { newId } from "@/domain/ids";
import { errorIssue, type Issue } from "@/domain/issues";
import { sha256Bytes } from "@/domain/json";
import { isRecordType } from "@/domain/recordTypes";
import { Prisma } from "@/generated/prisma/client";
import {
  formatBytes,
  IMAGE_FORMAT_LABELS,
  imageNameFor,
  imageNamesInText,
  isImageMimeType,
  MAX_ALT_CHARS,
  MAX_CAPTION_CHARS,
  MAX_IMAGE_BYTES,
  MAX_IMAGES_PER_RECORD,
  sniffImage,
  type ImageMimeType,
} from "@/images/imageFormat";
import type { Db, DbOrTx, Tx } from "../db";
import { writeAudit } from "./auditService";
import { MutationRejectedError, NotFoundError } from "./errors";
import { LIVE_RECORD } from "./trashFilters";
import { deleteMapsForImageInTx } from "./worldMapService";

/*
 * Images on chapters, scenes, and reference documents. An image is not record
 * content: adding, editing or removing one creates no revision and never changes
 * the record's text, so it does not go through mutationService. Every change is
 * audited. Protected records need the same explicit tick as editing their text.
 */

const UI_ACTOR = "author";

export interface RecordImageView {
  id: string;
  recordId: string;
  name: string;
  originalFilename: string;
  mimeType: ImageMimeType;
  byteSize: number;
  width: number;
  height: number;
  contentHash: string;
  caption: string;
  altText: string;
  position: number;
  isPrimary: boolean;
  createdAt: Date;
}

export interface NewImageFile {
  filename: string;
  bytes: Uint8Array;
}

const META = {
  id: true,
  recordId: true,
  name: true,
  originalFilename: true,
  mimeType: true,
  byteSize: true,
  width: true,
  height: true,
  contentHash: true,
  caption: true,
  altText: true,
  position: true,
  isPrimary: true,
  createdAt: true,
} as const;

function rejected(code: Issue["code"], message: string, extra: Partial<Issue> = {}): MutationRejectedError {
  return new MutationRejectedError([errorIssue(code, message, extra)]);
}

function view(row: Prisma.RecordImageGetPayload<{ select: typeof META }>): RecordImageView | null {
  return isImageMimeType(row.mimeType) ? { ...row, mimeType: row.mimeType } : null;
}

/** True when the database has not been migrated to include images yet (`pnpm db:deploy`). */
export function isImagesTableMissing(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021";
}

/** A record's images in gallery order, without their bytes. Null when the images table does not exist yet. */
export async function listRecordImages(db: DbOrTx, projectId: string, recordId: string): Promise<RecordImageView[] | null> {
  try {
    const rows = await db.recordImage.findMany({
      where: { projectId, recordId },
      orderBy: [{ position: "asc" }, { id: "asc" }],
      select: META,
    });
    return rows.flatMap((r) => view(r) ?? []);
  } catch (error) {
    if (isImagesTableMissing(error)) return null;
    throw error;
  }
}

/** Images of several records, keyed by record ID, for exports. */
export async function imagesByRecord(db: DbOrTx, projectId: string, recordIds: string[]): Promise<Map<string, RecordImageView[]>> {
  const map = new Map<string, RecordImageView[]>();
  let rows: Prisma.RecordImageGetPayload<{ select: typeof META }>[] = [];
  try {
    rows = await db.recordImage.findMany({
      where: { projectId, recordId: { in: recordIds } },
      orderBy: [{ recordId: "asc" }, { position: "asc" }, { id: "asc" }],
      select: META,
    });
  } catch (error) {
    if (!isImagesTableMissing(error)) throw error;
  }
  for (const r of rows) {
    const v = view(r);
    if (v) map.set(r.recordId, [...(map.get(r.recordId) ?? []), v]);
  }
  return map;
}

export interface ImageData {
  id: string;
  name: string;
  mimeType: ImageMimeType;
  contentHash: string;
  data: Uint8Array;
}

export async function getImageData(db: DbOrTx, projectId: string, imageId: string): Promise<ImageData> {
  const row = await db.recordImage.findFirst({
    where: { id: imageId, projectId, record: LIVE_RECORD },
    select: { id: true, name: true, mimeType: true, contentHash: true, data: true },
  });
  if (!row || !isImageMimeType(row.mimeType)) throw new NotFoundError(`Image ${imageId} not found`);
  return { ...row, mimeType: row.mimeType, data: new Uint8Array(row.data) };
}

/** Image bytes for the given image IDs, for the PDF export. */
export async function imageDataByIds(db: DbOrTx, projectId: string, imageIds: string[]): Promise<Map<string, Uint8Array>> {
  if (!imageIds.length) return new Map();
  const rows = await db.recordImage.findMany({ where: { projectId, id: { in: imageIds } }, select: { id: true, data: true } });
  return new Map(rows.map((r) => [r.id, new Uint8Array(r.data)]));
}

async function findImageRecord(tx: DbOrTx, projectId: string, recordId: string) {
  const record = await tx.record.findFirst({
    where: { id: recordId, projectId, trashedAt: null },
    select: { id: true, title: true, type: true, body: true, protected: true },
  });
  if (!record) throw rejected("RECORD_NOT_FOUND", `Record ${recordId} does not exist in this project.`, { recordId });
  if (!isRecordType(record.type)) {
    throw rejected("INVALID_REFERENCE", `This record type cannot have images.`, { recordId });
  }
  return record;
}

function requireUnlock(record: { id: string; title: string; protected: boolean }, confirmProtected: boolean) {
  if (record.protected && !confirmProtected) {
    throw rejected(
      "PROTECTED_CONFIRMATION_REQUIRED",
      `"${record.title}" is protected. Tick the protection box to change its images.`,
      { recordId: record.id },
    );
  }
}

/** Checks every file before anything is written; a single bad file rejects the whole batch. */
export function validateImageFiles(files: readonly NewImageFile[]): { issues: Issue[]; infos: ReturnType<typeof sniffImage>[] } {
  const issues: Issue[] = [];
  const infos = files.map((f, i) => {
    const label = f.filename || `File ${i + 1}`;
    if (f.bytes.byteLength === 0) {
      issues.push(errorIssue("IMAGE_INVALID", `${label} is empty.`, { path: `files.${i}` }));
      return null;
    }
    if (f.bytes.byteLength > MAX_IMAGE_BYTES) {
      issues.push(
        errorIssue("IMAGE_INVALID", `${label} is ${formatBytes(f.bytes.byteLength)}; the limit is ${formatBytes(MAX_IMAGE_BYTES)}.`, {
          path: `files.${i}`,
        }),
      );
      return null;
    }
    const info = sniffImage(f.bytes);
    if (!info) {
      const formats = Object.values(IMAGE_FORMAT_LABELS).join(", ");
      issues.push(errorIssue("IMAGE_INVALID", `${label} is not a ${formats} image.`, { path: `files.${i}` }));
    }
    return info;
  });
  return { issues, infos };
}

/** Inserts already-validated images inside the caller's transaction. */
export async function insertRecordImagesInTx(
  tx: Tx,
  projectId: string,
  recordId: string,
  files: readonly NewImageFile[],
  infos: NonNullable<ReturnType<typeof sniffImage>>[],
  options: { confirmProtected: boolean },
): Promise<RecordImageView[]> {
  const record = await findImageRecord(tx, projectId, recordId);
  requireUnlock(record, options.confirmProtected);
  const existing = await tx.recordImage.findMany({ where: { recordId }, select: { name: true, position: true } });
  if (existing.length + files.length > MAX_IMAGES_PER_RECORD) {
    throw rejected(
      "IMAGE_INVALID",
      `A document can have up to ${MAX_IMAGES_PER_RECORD} images; "${record.title}" has ${existing.length}.`,
      { recordId },
    );
  }
  const taken = new Set(existing.map((e) => e.name));
  let position = existing.reduce((max, e) => Math.max(max, e.position), 0);
  const created: RecordImageView[] = [];
  for (const [i, file] of files.entries()) {
    const info = infos[i]!;
    const name = imageNameFor(file.filename, info.mimeType, taken);
    taken.add(name);
    position += 1;
    const row = await tx.recordImage.create({
      data: {
        id: newId("img"),
        projectId,
        recordId,
        name,
        originalFilename: file.filename.slice(0, 255) || name,
        mimeType: info.mimeType,
        byteSize: file.bytes.byteLength,
        width: info.width,
        height: info.height,
        contentHash: sha256Bytes(file.bytes),
        data: Buffer.from(file.bytes),
        position,
      },
      select: META,
    });
    created.push(view(row)!);
  }
  await writeAudit(tx, {
    projectId,
    action: "record.image.add",
    actor: UI_ACTOR,
    summary:
      created.length === 1
        ? `Added image "${created[0].name}" to "${record.title}"`
        : `Added ${created.length} images to "${record.title}"`,
    details: {
      recordId,
      images: created.map((c) => ({ imageId: c.id, name: c.name, mimeType: c.mimeType, byteSize: c.byteSize, contentHash: c.contentHash })),
    },
  });
  return created;
}

export async function addRecordImages(
  db: Db,
  projectId: string,
  recordId: string,
  files: readonly NewImageFile[],
  options: { confirmProtected: boolean },
): Promise<RecordImageView[]> {
  if (!files.length) throw rejected("IMAGE_INVALID", "Choose at least one image.");
  const { issues, infos } = validateImageFiles(files);
  if (issues.length) throw new MutationRejectedError(issues);
  const sniffed = infos.filter((info): info is NonNullable<typeof info> => info !== null);
  if (sniffed.length !== files.length) throw new MutationRejectedError(issues);

  return db.$transaction((tx) => insertRecordImagesInTx(tx, projectId, recordId, files, sniffed, options));
}

async function findImage(tx: Tx, projectId: string, imageId: string) {
  const image = await tx.recordImage.findFirst({ where: { id: imageId, projectId }, select: { ...META, projectId: true } });
  if (!image) throw rejected("INVALID_REFERENCE", "That image no longer exists.");
  return image;
}

export async function updateRecordImage(
  db: Db,
  projectId: string,
  imageId: string,
  changes: { caption: string; altText: string },
  options: { confirmProtected: boolean },
): Promise<void> {
  const caption = changes.caption.trim();
  const altText = changes.altText.trim();
  if (caption.length > MAX_CAPTION_CHARS) throw rejected("IMAGE_INVALID", `Captions can be up to ${MAX_CAPTION_CHARS} characters.`);
  if (altText.length > MAX_ALT_CHARS) throw rejected("IMAGE_INVALID", `Descriptions can be up to ${MAX_ALT_CHARS} characters.`);
  await db.$transaction(async (tx) => {
    const image = await findImage(tx, projectId, imageId);
    const record = await findImageRecord(tx, projectId, image.recordId);
    requireUnlock(record, options.confirmProtected);
    if (image.caption === caption && image.altText === altText) return;
    await tx.recordImage.update({ where: { id: imageId }, data: { caption, altText } });
    await writeAudit(tx, {
      projectId,
      action: "record.image.update",
      actor: UI_ACTOR,
      summary: `Changed the caption or description of image "${image.name}" on "${record.title}"`,
      details: {
        recordId: record.id,
        imageId,
        name: image.name,
        before: { caption: image.caption, altText: image.altText },
        after: { caption, altText },
      },
    });
  });
}

/** Primary profile image per record (for relationship graphs and previews). */
export async function primaryRecordImagesByRecordId(
  db: DbOrTx,
  projectId: string,
  recordIds: readonly string[],
): Promise<Map<string, string>> {
  if (!recordIds.length) return new Map();
  try {
    const rows = await db.recordImage.findMany({
      where: { projectId, recordId: { in: [...recordIds] }, isPrimary: true },
      select: { recordId: true, id: true },
    });
    return new Map(rows.map((r) => [r.recordId, r.id]));
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2022") {
      return new Map();
    }
    throw error;
  }
}

export function recordImagePublicPath(projectId: string, imageId: string): string {
  return `/projects/${encodeURIComponent(projectId)}/images/${encodeURIComponent(imageId)}`;
}

export async function setRecordImagePrimary(
  db: Db,
  projectId: string,
  recordId: string,
  imageId: string,
  options: { confirmProtected: boolean },
): Promise<void> {
  await db.$transaction(async (tx) => {
    const image = await findImage(tx, projectId, imageId);
    if (image.recordId !== recordId) throw rejected("INVALID_REFERENCE", "That image is not on this record.");
    const record = await findImageRecord(tx, projectId, recordId);
    requireUnlock(record, options.confirmProtected);
    await tx.recordImage.updateMany({ where: { recordId, projectId }, data: { isPrimary: false } });
    await tx.recordImage.update({ where: { id: imageId }, data: { isPrimary: true } });
    await writeAudit(tx, {
      projectId,
      action: "record.image.set_primary",
      actor: UI_ACTOR,
      summary: `Set "${image.name}" as the profile image on "${record.title}"`,
      details: { recordId, imageId, name: image.name },
    });
  });
}

export async function removeRecordImage(db: Db, projectId: string, imageId: string, options: { confirmProtected: boolean }): Promise<void> {
  await db.$transaction(async (tx) => {
    const image = await findImage(tx, projectId, imageId);
    const record = await findImageRecord(tx, projectId, image.recordId);
    requireUnlock(record, options.confirmProtected);
    if (imageNamesInText(record.body).includes(image.name)) {
      throw rejected(
        "INVALID_REFERENCE",
        `The text of "${record.title}" shows image:${image.name}. Remove it from the text and save first.`,
        { recordId: record.id },
      );
    }
    // Permanent image remove deletes maps that used this image as a backdrop.
    await deleteMapsForImageInTx(tx, projectId, imageId);
    await tx.boardCard.deleteMany({ where: { imageId } });
    await tx.recordImage.delete({ where: { id: imageId } });
    await writeAudit(tx, {
      projectId,
      action: "record.image.remove",
      actor: UI_ACTOR,
      summary: `Removed image "${image.name}" from "${record.title}"`,
      details: { recordId: record.id, imageId, name: image.name, contentHash: image.contentHash, byteSize: image.byteSize },
    });
  });
}
