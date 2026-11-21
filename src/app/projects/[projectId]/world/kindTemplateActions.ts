"use server";

import { revalidatePath } from "next/cache";
import type { KindTemplateField } from "@/world/kindTemplates";
import { getDb } from "@/server/db";
import { deleteWorldKindTemplate, saveWorldKindTemplate } from "@/server/services/worldKindTemplateService";

export async function saveWorldKindTemplateAction(
  projectId: string,
  kind: string,
  fields: KindTemplateField[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await saveWorldKindTemplate(getDb(), { projectId, kind, fields, actor: "author" });
    revalidatePath(`/projects/${projectId}`, "layout");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not remember these fields." };
  }
}

export async function forgetWorldKindTemplateAction(
  projectId: string,
  kind: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await deleteWorldKindTemplate(getDb(), { projectId, kind, actor: "author" });
    revalidatePath(`/projects/${projectId}`, "layout");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not forget these fields." };
  }
}
