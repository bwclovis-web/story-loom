"use server";

import { revalidatePath } from "next/cache";
import { errorIssue, type Issue } from "@/domain/issues";
import { getDb } from "@/server/db";
import {
  addPlaceRelation,
  isPlaceRelationKind,
  removePlaceRelation,
  type PlaceRelationKind,
} from "@/server/services/placeRelationService";
import { MutationRejectedError, NotFoundError } from "@/server/services/errors";
import { validateImageFiles } from "@/server/services/imageService";
import {
  addWorldMapPin,
  createWorldMap,
  createWorldMapWithUpload,
  deleteWorldMap,
  moveWorldMapPin,
  removeWorldMapPin,
  renameWorldMap,
  setWorldMapPinGeometry,
  updateWorldMapPin,
  updateWorldMapScale,
  saveWorldMapLayers,
  type WorldMapPinLinks,
} from "@/server/services/worldMapService";

function failure(error: unknown): { ok: false; issues: Issue[] } {
  if (error instanceof MutationRejectedError) return { ok: false, issues: error.issues };
  if (error instanceof NotFoundError) return { ok: false, issues: [errorIssue("RECORD_NOT_FOUND", error.message)] };
  return { ok: false, issues: [errorIssue("INVALID_CHANGE", (error as Error).message)] };
}

function revalidateMaps(projectId: string, mapId?: string) {
  revalidatePath(`/projects/${projectId}/world/maps`);
  if (mapId) revalidatePath(`/projects/${projectId}/world/maps/${mapId}`);
  revalidatePath(`/projects/${projectId}`, "layout");
}

export async function createWorldMapAction(
  projectId: string,
  input: { title: string; imageId: string },
): Promise<{ ok: true; mapId: string } | { ok: false; issues: Issue[] }> {
  try {
    const map = await createWorldMap(getDb(), projectId, input);
    revalidateMaps(projectId, map.id);
    return { ok: true, mapId: map.id };
  } catch (error) {
    return failure(error);
  }
}

export async function createWorldMapUploadAction(
  projectId: string,
  formData: FormData,
): Promise<{ ok: true; mapId: string } | { ok: false; issues: Issue[] }> {
  const title = String(formData.get("title") ?? "");
  const recordId = String(formData.get("recordId") ?? "");
  const confirmProtected = formData.get("confirmProtected") === "on";
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, issues: [errorIssue("IMAGE_INVALID", "Choose an image to upload.")] };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const checked = validateImageFiles([{ filename: file.name, bytes }]);
  if (checked.issues.length) return { ok: false, issues: checked.issues };
  try {
    const map = await createWorldMapWithUpload(getDb(), projectId, {
      title,
      recordId,
      confirmProtected,
      file: { filename: file.name, bytes },
    });
    revalidateMaps(projectId, map.id);
    return { ok: true, mapId: map.id };
  } catch (error) {
    return failure(error);
  }
}

export async function renameWorldMapAction(
  projectId: string,
  mapId: string,
  title: string,
): Promise<{ ok: true } | { ok: false; issues: Issue[] }> {
  try {
    await renameWorldMap(getDb(), projectId, mapId, title);
    revalidateMaps(projectId, mapId);
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function deleteWorldMapAction(
  projectId: string,
  mapId: string,
): Promise<{ ok: true } | { ok: false; issues: Issue[] }> {
  try {
    await deleteWorldMap(getDb(), projectId, mapId);
    revalidateMaps(projectId);
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function addWorldMapPinAction(
  projectId: string,
  mapId: string,
  input: WorldMapPinLinks & {
    xNorm: number;
    yNorm: number;
    kind?: string | null;
    points?: { x: number; y: number }[] | null;
  },
) {
  try {
    const pin = await addWorldMapPin(getDb(), projectId, mapId, input);
    revalidateMaps(projectId, mapId);
    return { ok: true as const, pin };
  } catch (error) {
    return failure(error);
  }
}

export async function updateWorldMapPinAction(
  projectId: string,
  mapId: string,
  pinId: string,
  input: WorldMapPinLinks,
) {
  try {
    const pin = await updateWorldMapPin(getDb(), projectId, mapId, pinId, input);
    revalidateMaps(projectId, mapId);
    return { ok: true as const, pin };
  } catch (error) {
    return failure(error);
  }
}

export async function moveWorldMapPinAction(
  projectId: string,
  mapId: string,
  pinId: string,
  input: { xNorm: number; yNorm: number; expectedRevision?: number | null },
) {
  try {
    const pin = await moveWorldMapPin(getDb(), projectId, mapId, pinId, input);
    revalidateMaps(projectId, mapId);
    return { ok: true as const, pin };
  } catch (error) {
    return failure(error);
  }
}

export async function setWorldMapPinGeometryAction(
  projectId: string,
  mapId: string,
  pinId: string,
  input: { expectedRevision: number; points: { x: number; y: number }[] },
) {
  try {
    const pin = await setWorldMapPinGeometry(getDb(), projectId, mapId, pinId, input);
    revalidateMaps(projectId, mapId);
    return { ok: true as const, pin };
  } catch (error) {
    return failure(error);
  }
}

export async function removeWorldMapPinAction(
  projectId: string,
  mapId: string,
  pinId: string,
  expectedRevision?: number,
) {
  try {
    await removeWorldMapPin(getDb(), projectId, mapId, pinId, expectedRevision);
    revalidateMaps(projectId, mapId);
    return { ok: true as const };
  } catch (error) {
    return failure(error);
  }
}

export async function addPlaceRelationAction(
  projectId: string,
  input: { fromRecordId: string; toRecordId: string; kind: string },
) {
  try {
    if (!isPlaceRelationKind(input.kind)) {
      return { ok: false as const, issues: [errorIssue("INVALID_REFERENCE", "Unknown relationship kind.")] };
    }
    const relation = await addPlaceRelation(getDb(), projectId, {
      fromRecordId: input.fromRecordId,
      toRecordId: input.toRecordId,
      kind: input.kind as PlaceRelationKind,
    });
    revalidatePath(`/projects/${projectId}/records/${input.fromRecordId}`);
    revalidatePath(`/projects/${projectId}/records/${input.toRecordId}`);
    return { ok: true as const, relation };
  } catch (error) {
    return failure(error);
  }
}

export async function updateWorldMapScaleAction(
  projectId: string,
  mapId: string,
  input: { scaleLabel: string; scaleBarLength: number | null },
) {
  try {
    const map = await updateWorldMapScale(getDb(), projectId, mapId, input);
    revalidateMaps(projectId, mapId);
    return { ok: true as const, map };
  } catch (error) {
    return failure(error);
  }
}

export async function saveWorldMapLayersAction(
  projectId: string,
  mapId: string,
  layers: readonly { title: string }[],
) {
  try {
    const map = await saveWorldMapLayers(getDb(), projectId, mapId, layers);
    revalidateMaps(projectId, mapId);
    return { ok: true as const, map };
  } catch (error) {
    return failure(error);
  }
}

export async function removePlaceRelationAction(projectId: string, relationId: string, recordIds: string[]) {
  try {
    await removePlaceRelation(getDb(), projectId, relationId);
    for (const id of recordIds) revalidatePath(`/projects/${projectId}/records/${id}`);
    return { ok: true as const };
  } catch (error) {
    return failure(error);
  }
}
