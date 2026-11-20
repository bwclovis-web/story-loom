"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { ConfirmResult } from "@/components/ConfirmAction";
import { errorIssue } from "@/domain/issues";
import { getDb } from "@/server/db";
import { clearProjectCover, setProjectCover } from "@/server/services/coverService";
import { MutationRejectedError, NotFoundError } from "@/server/services/errors";
import { createProject, createWorkspace } from "@/server/services/projectService";
import { trashWorkspace } from "@/server/services/trashService";

export type CoverResult = { ok: true } | { ok: false; message: string };

function coverFailure(error: unknown): CoverResult | null {
  if (error instanceof MutationRejectedError) return { ok: false, message: error.issues[0]?.message ?? "The cover was not saved." };
  if (error instanceof NotFoundError) return { ok: false, message: "That manuscript is not available." };
  return null;
}

export async function createWorkspaceAction(formData: FormData) {
  await createWorkspace(getDb(), { name: String(formData.get("name") ?? "") });
  revalidatePath("/");
}

export async function createProjectAction(formData: FormData) {
  const project = await createProject(getDb(), {
    workspaceId: String(formData.get("workspaceId") ?? ""),
    title: String(formData.get("title") ?? ""),
  });
  redirect(`/projects/${project.id}`);
}

export async function setCoverAction(projectId: string, formData: FormData): Promise<CoverResult> {
  const file = formData.get("cover");
  if (!(file instanceof File)) return { ok: false, message: "Choose an image file." };
  try {
    await setProjectCover(getDb(), { projectId, filename: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
  } catch (error) {
    const failure = coverFailure(error);
    if (failure) return failure;
    throw error;
  }
  revalidatePath("/");
  return { ok: true };
}

export async function clearCoverAction(projectId: string): Promise<CoverResult> {
  try {
    await clearProjectCover(getDb(), { projectId });
  } catch (error) {
    const failure = coverFailure(error);
    if (failure) return failure;
    throw error;
  }
  revalidatePath("/");
  return { ok: true };
}

export async function trashWorkspaceAction(workspaceId: string): Promise<ConfirmResult> {
  try {
    await trashWorkspace(getDb(), { workspaceId, actor: "author" });
  } catch (error) {
    return { ok: false, issues: [errorIssue("RECORD_NOT_FOUND", (error as Error).message)] };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}
