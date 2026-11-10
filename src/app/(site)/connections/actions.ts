"use server";

import { revalidatePath } from "next/cache";
import { PROJECT_ID_PATTERN } from "@/domain/ids";
import { getDb } from "@/server/db";
import { saveGrantSettings, type GrantSettingsResult } from "@/server/services/grantSettingsService";

export async function saveGrantSettingsAction(_previous: GrantSettingsResult | null, formData: FormData): Promise<GrantSettingsResult> {
  const projectIds = formData.getAll("projectId").map(String);
  if (projectIds.some((id) => !PROJECT_ID_PATTERN.test(id))) {
    return { ok: false, message: "The project selection could not be read. Nothing was saved." };
  }
  const result = await saveGrantSettings(getDb(), process.env, process.cwd(), {
    active: formData.get("active") === "on",
    projectIds,
    manuscriptRead: formData.get("manuscriptRead") === "on",
  });
  revalidatePath("/connections");
  return result;
}
