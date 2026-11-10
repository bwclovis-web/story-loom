"use server";

import { revalidatePath } from "next/cache";
import { errorIssue } from "@/domain/issues";
import { getDb } from "@/server/db";
import { MutationRejectedError } from "@/server/services/errors";
import { addRecordImages, isImagesTableMissing, removeRecordImage, updateRecordImage } from "@/server/services/imageService";
import { IMAGES } from "@/ui/labels";
import type { FormResult } from "../../actions";

function failure(error: unknown): FormResult {
  if (error instanceof MutationRejectedError) return { ok: false, issues: error.issues };
  if (isImagesTableMissing(error)) return { ok: false, issues: [errorIssue("IMAGE_INVALID", IMAGES.migrationNeeded)] };
  return { ok: false, issues: [errorIssue("IMAGE_INVALID", (error as Error).message)] };
}

const confirmed = (formData: FormData) => formData.get("unlockProtected") === "on";

export async function addImagesAction(projectId: string, recordId: string, _prev: FormResult, formData: FormData): Promise<FormResult> {
  const files = formData.getAll("images").filter((f): f is File => f instanceof File && f.size > 0);
  try {
    const created = await addRecordImages(
      getDb(),
      projectId,
      recordId,
      await Promise.all(files.map(async (f) => ({ filename: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }))),
      { confirmProtected: confirmed(formData) },
    );
    revalidatePath(`/projects/${projectId}/records/${recordId}`);
    return { ok: true, message: created.length === 1 ? `Added ${created[0].name}.` : `Added ${created.length} images.` };
  } catch (error) {
    return failure(error);
  }
}

export async function updateImageAction(
  projectId: string,
  recordId: string,
  imageId: string,
  _prev: FormResult,
  formData: FormData,
): Promise<FormResult> {
  try {
    await updateRecordImage(
      getDb(),
      projectId,
      imageId,
      { caption: String(formData.get("caption") ?? ""), altText: String(formData.get("altText") ?? "") },
      { confirmProtected: confirmed(formData) },
    );
    revalidatePath(`/projects/${projectId}/records/${recordId}`);
    return { ok: true, message: "Saved." };
  } catch (error) {
    return failure(error);
  }
}

export async function removeImageAction(
  projectId: string,
  recordId: string,
  imageId: string,
  _prev: FormResult,
  formData: FormData,
): Promise<FormResult> {
  try {
    await removeRecordImage(getDb(), projectId, imageId, { confirmProtected: confirmed(formData) });
    revalidatePath(`/projects/${projectId}/records/${recordId}`);
    return { ok: true, message: "Removed." };
  } catch (error) {
    return failure(error);
  }
}
