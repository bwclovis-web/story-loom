"use server";

import { revalidatePath } from "next/cache";
import type { WorldScope } from "@/domain/assignments";
import { getDb } from "@/server/db";
import {
  deleteWorldCategory,
  saveWorldCategory,
  setWorldCategoryScope,
} from "@/server/services/worldCategoryService";

export type CategoryActionResult = { ok: true } | { ok: false; error: string };

export async function saveWorldCategoryAction(
  projectId: string,
  input: {
    slug: string;
    label: string;
    description?: string;
    parentCategorySlug?: string | null;
    worldScope?: WorldScope | null;
  },
): Promise<CategoryActionResult> {
  try {
    await saveWorldCategory(getDb(), { projectId, ...input, actor: "author" });
    revalidatePath(`/projects/${projectId}`, "layout");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not save category." };
  }
}

export async function setWorldCategoryScopeAction(
  projectId: string,
  slug: string,
  worldScope: WorldScope | null,
): Promise<CategoryActionResult> {
  try {
    await setWorldCategoryScope(getDb(), { projectId, slug, worldScope, actor: "author" });
    revalidatePath(`/projects/${projectId}`, "layout");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not update category scope." };
  }
}

export async function deleteWorldCategoryAction(
  projectId: string,
  slug: string,
): Promise<CategoryActionResult> {
  try {
    await deleteWorldCategory(getDb(), { projectId, slug, actor: "author" });
    revalidatePath(`/projects/${projectId}`, "layout");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not remove category." };
  }
}
