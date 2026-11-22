import { newId } from "@/domain/ids";
import { errorIssue } from "@/domain/issues";
import {
  formatAuthorInstructionLens,
  isPromptPresetSurface,
  PROMPT_PRESET_INSTRUCTION_MAX,
  PROMPT_PRESET_TITLE_MAX,
  type PromptPresetSurface,
} from "@/domain/promptPreset";
import type { BuiltRequest } from "@/assistant/prompt";
import type { Db, DbOrTx } from "@/server/db";
import { writeAudit } from "./auditService";
import { MutationRejectedError, NotFoundError } from "./errors";
import { LIVE_PROJECT } from "./trashFilters";

const UI_ACTOR = "author";

export interface PromptPresetView {
  id: string;
  projectId: string;
  title: string;
  surface: PromptPresetSurface;
  instructionText: string;
  createdAt: Date;
  updatedAt: Date;
}

function rejected(message: string): MutationRejectedError {
  return new MutationRejectedError([errorIssue("INVALID_CHANGE", message)]);
}

function toView(row: {
  id: string;
  projectId: string;
  title: string;
  surface: string;
  instructionText: string;
  createdAt: Date;
  updatedAt: Date;
}): PromptPresetView {
  const surface: PromptPresetSurface = isPromptPresetSurface(row.surface) ? row.surface : "chat";
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    surface,
    instructionText: row.instructionText,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function requireProject(db: DbOrTx, projectId: string) {
  const project = await db.project.findFirst({ where: { id: projectId, ...LIVE_PROJECT }, select: { id: true } });
  if (!project) throw new NotFoundError(`Project ${projectId} not found`);
}

function normalizeTitle(title: string): string {
  const trimmed = title.trim().slice(0, PROMPT_PRESET_TITLE_MAX);
  if (trimmed.length < 1) throw rejected("Give the preset a name.");
  return trimmed;
}

function normalizeInstruction(instructionText: string): string {
  const trimmed = instructionText.trim().slice(0, PROMPT_PRESET_INSTRUCTION_MAX);
  if (trimmed.length < 1) throw rejected("Add instruction text for this preset.");
  return trimmed;
}

export function normalizeAuthorInstructionText(instructionText: string | null | undefined): string {
  if (!instructionText) return "";
  return instructionText.trim().slice(0, PROMPT_PRESET_INSTRUCTION_MAX);
}

export function applyAuthorInstructionLens(built: BuiltRequest, instructionText: string | null | undefined): void {
  const block = formatAuthorInstructionLens(normalizeAuthorInstructionText(instructionText));
  if (!block) return;
  built.instructions = `${built.instructions}${block}`;
  built.totalChars += block.length;
  built.items.push({ label: "Author instruction lens", chars: block.length });
}

export async function listPromptPresets(
  db: DbOrTx,
  projectId: string,
  surface?: PromptPresetSurface,
): Promise<PromptPresetView[]> {
  await requireProject(db, projectId);
  const rows = await db.assistantPromptPreset.findMany({
    where: { projectId, ...(surface ? { surface } : {}) },
    orderBy: [{ surface: "asc" }, { title: "asc" }, { id: "asc" }],
  });
  return rows.map(toView);
}

export async function getPromptPreset(db: DbOrTx, projectId: string, presetId: string): Promise<PromptPresetView> {
  await requireProject(db, projectId);
  const row = await db.assistantPromptPreset.findFirst({ where: { id: presetId, projectId } });
  if (!row) throw new NotFoundError(`Prompt preset ${presetId} not found`);
  return toView(row);
}

export async function createPromptPreset(
  db: Db,
  projectId: string,
  input: { title: string; surface: PromptPresetSurface; instructionText: string },
): Promise<PromptPresetView> {
  await requireProject(db, projectId);
  if (!isPromptPresetSurface(input.surface)) throw rejected("Choose selection, chat, or beat for this preset.");
  const title = normalizeTitle(input.title);
  const instructionText = normalizeInstruction(input.instructionText);
  const id = newId("apre");
  const row = await db.$transaction(async (tx) => {
    const created = await tx.assistantPromptPreset.create({
      data: { id, projectId, title, surface: input.surface, instructionText },
    });
    await writeAudit(tx, {
      projectId,
      actor: UI_ACTOR,
      action: "assistant_prompt_preset.create",
      summary: `Created prompt preset "${title}" (${input.surface})`,
      details: { presetId: id, surface: input.surface },
    });
    return created;
  });
  return toView(row);
}

export async function updatePromptPreset(
  db: Db,
  projectId: string,
  presetId: string,
  input: { title?: string; surface?: PromptPresetSurface; instructionText?: string },
): Promise<PromptPresetView> {
  await requireProject(db, projectId);
  const existing = await db.assistantPromptPreset.findFirst({ where: { id: presetId, projectId } });
  if (!existing) throw new NotFoundError(`Prompt preset ${presetId} not found`);
  if (input.surface !== undefined && !isPromptPresetSurface(input.surface)) {
    throw rejected("Choose selection, chat, or beat for this preset.");
  }
  const title = input.title !== undefined ? normalizeTitle(input.title) : existing.title;
  const surface = input.surface ?? (isPromptPresetSurface(existing.surface) ? existing.surface : "chat");
  const instructionText =
    input.instructionText !== undefined ? normalizeInstruction(input.instructionText) : existing.instructionText;
  const row = await db.$transaction(async (tx) => {
    const updated = await tx.assistantPromptPreset.update({
      where: { id: presetId },
      data: { title, surface, instructionText },
    });
    await writeAudit(tx, {
      projectId,
      actor: UI_ACTOR,
      action: "assistant_prompt_preset.update",
      summary: `Updated prompt preset "${title}"`,
      details: { presetId, surface },
    });
    return updated;
  });
  return toView(row);
}

export async function deletePromptPreset(db: Db, projectId: string, presetId: string): Promise<void> {
  await requireProject(db, projectId);
  const existing = await db.assistantPromptPreset.findFirst({ where: { id: presetId, projectId } });
  if (!existing) throw new NotFoundError(`Prompt preset ${presetId} not found`);
  await db.$transaction(async (tx) => {
    await tx.assistantPromptPreset.delete({ where: { id: presetId } });
    await writeAudit(tx, {
      projectId,
      actor: UI_ACTOR,
      action: "assistant_prompt_preset.delete",
      summary: `Deleted prompt preset "${existing.title}"`,
      details: { presetId, surface: existing.surface },
    });
  });
}