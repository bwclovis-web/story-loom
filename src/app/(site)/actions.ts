"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { ConfirmResult } from "@/components/ConfirmAction";
import { errorIssue } from "@/domain/issues";
import { getDb } from "@/server/db";
import { createProject, createWorkspace } from "@/server/services/projectService";
import { trashWorkspace } from "@/server/services/trashService";

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

export async function trashWorkspaceAction(workspaceId: string): Promise<ConfirmResult> {
  try {
    await trashWorkspace(getDb(), { workspaceId, actor: "author" });
  } catch (error) {
    return { ok: false, issues: [errorIssue("RECORD_NOT_FOUND", (error as Error).message)] };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}
