"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { ConfirmResult } from "@/components/ConfirmAction";
import { errorIssue } from "@/domain/issues";
import { getDb } from "@/server/db";
import { clearProjectCover, setProjectCover } from "@/server/services/coverService";
import { MutationRejectedError, NotFoundError } from "@/server/services/errors";
import { createProject, createWorkspace, renameProject, renameWorkspace } from "@/server/services/projectService";
import { applyProjectTemplate } from "@/server/services/projectTemplateService";
import { trashWorkspace } from "@/server/services/trashService";

export type CoverResult = { ok: true } | { ok: false; message: string };

function coverFailure(error: unknown): CoverResult | null {
  if (error instanceof MutationRejectedError) return { ok: false, message: error.issues[0]?.message ?? "The cover was not saved." };
  if (error instanceof NotFoundError) return { ok: false, message: "That manuscript is not available." };
  return null;
}

export async function createWorkspaceAction(formData: FormData) {
  await createWorkspace(getDb(), { name: String(formData.get("name") ?? "") });
  revalidatePath("/", "layout");
}

export async function createProjectAction(formData: FormData) {
  const db = getDb();
  const project = await createProject(db, {
    workspaceId: String(formData.get("workspaceId") ?? ""),
    title: String(formData.get("title") ?? ""),
  });
  await applyProjectTemplate(db, project.id, String(formData.get("template") ?? ""));
  revalidatePath("/", "layout");
  redirect(`/projects/${project.id}/write`);
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

export async function renameWorkspaceAction(workspaceId: string, name: string): Promise<CoverResult> {
  try {
    await renameWorkspace(getDb(), { workspaceId, name, actor: "author" });
  } catch (error) {
    if (error instanceof NotFoundError) return { ok: false, message: "That workspace is not available." };
    return { ok: false, message: (error as Error).message };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function renameProjectAction(projectId: string, title: string): Promise<CoverResult> {
  try {
    await renameProject(getDb(), { projectId, title, actor: "author" });
  } catch (error) {
    if (error instanceof NotFoundError) return { ok: false, message: "That manuscript is not available." };
    return { ok: false, message: (error as Error).message };
  }
  revalidatePath("/", "layout");
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
