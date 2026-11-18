"use server";

import { revalidatePath } from "next/cache";
import { errorIssue, type Issue } from "@/domain/issues";
import { getDb } from "@/server/db";
import {
  addImageCard,
  addNoteCard,
  addRecordCard,
  createBoard,
  deleteBoard,
  isBoardTemplateKey,
  moveBoardCard,
  removeBoardCard,
  renameBoard,
  updateNoteCard,
  type BoardTemplateKey,
} from "@/server/services/boardService";
import { previewBoardAskContext, type BoardAskPreview } from "@/server/services/establishedFactService";
import { MutationRejectedError, NotFoundError } from "@/server/services/errors";

function failure(error: unknown): { ok: false; issues: Issue[] } {
  if (error instanceof MutationRejectedError) return { ok: false, issues: error.issues };
  if (error instanceof NotFoundError) return { ok: false, issues: [errorIssue("RECORD_NOT_FOUND", error.message)] };
  return { ok: false, issues: [errorIssue("INVALID_CHANGE", (error as Error).message)] };
}

function revalidateBoards(projectId: string, boardId?: string) {
  revalidatePath(`/projects/${projectId}/world/boards`);
  if (boardId) revalidatePath(`/projects/${projectId}/world/boards/${boardId}`);
  revalidatePath(`/projects/${projectId}`, "layout");
}

export async function createBoardAction(
  projectId: string,
  input: { title: string; templateKey: string },
): Promise<{ ok: true; boardId: string } | { ok: false; issues: Issue[] }> {
  try {
    if (!isBoardTemplateKey(input.templateKey)) {
      return { ok: false, issues: [errorIssue("INVALID_REFERENCE", "Unknown board template.")] };
    }
    const board = await createBoard(getDb(), projectId, {
      title: input.title,
      templateKey: input.templateKey as BoardTemplateKey,
    });
    revalidateBoards(projectId, board.id);
    return { ok: true, boardId: board.id };
  } catch (error) {
    return failure(error);
  }
}

export async function renameBoardAction(
  projectId: string,
  boardId: string,
  title: string,
): Promise<{ ok: true } | { ok: false; issues: Issue[] }> {
  try {
    await renameBoard(getDb(), projectId, boardId, title);
    revalidateBoards(projectId, boardId);
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function deleteBoardAction(
  projectId: string,
  boardId: string,
): Promise<{ ok: true } | { ok: false; issues: Issue[] }> {
  try {
    await deleteBoard(getDb(), projectId, boardId);
    revalidateBoards(projectId);
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function addRecordCardAction(
  projectId: string,
  boardId: string,
  input: { recordId: string; x: number; y: number },
) {
  try {
    const card = await addRecordCard(getDb(), projectId, boardId, input);
    revalidateBoards(projectId, boardId);
    return { ok: true as const, card };
  } catch (error) {
    return failure(error);
  }
}

export async function addImageCardAction(
  projectId: string,
  boardId: string,
  input: { imageId: string; x: number; y: number },
) {
  try {
    const card = await addImageCard(getDb(), projectId, boardId, input);
    revalidateBoards(projectId, boardId);
    return { ok: true as const, card };
  } catch (error) {
    return failure(error);
  }
}

export async function addNoteCardAction(
  projectId: string,
  boardId: string,
  input: { noteTitle?: string; noteBody?: string; x: number; y: number },
) {
  try {
    const card = await addNoteCard(getDb(), projectId, boardId, input);
    revalidateBoards(projectId, boardId);
    return { ok: true as const, card };
  } catch (error) {
    return failure(error);
  }
}

export async function moveBoardCardAction(
  projectId: string,
  boardId: string,
  cardId: string,
  input: { x: number; y: number; width?: number; height?: number; zIndex?: number },
) {
  try {
    const card = await moveBoardCard(getDb(), projectId, boardId, cardId, input);
    revalidateBoards(projectId, boardId);
    return { ok: true as const, card };
  } catch (error) {
    return failure(error);
  }
}

export async function updateNoteCardAction(
  projectId: string,
  boardId: string,
  cardId: string,
  input: { noteTitle: string; noteBody: string },
) {
  try {
    const card = await updateNoteCard(getDb(), projectId, boardId, cardId, input);
    revalidateBoards(projectId, boardId);
    return { ok: true as const, card };
  } catch (error) {
    return failure(error);
  }
}

export async function removeBoardCardAction(projectId: string, boardId: string, cardId: string) {
  try {
    await removeBoardCard(getDb(), projectId, boardId, cardId);
    revalidateBoards(projectId, boardId);
    return { ok: true as const };
  } catch (error) {
    return failure(error);
  }
}

export async function previewBoardAskAction(
  projectId: string,
  boardId: string,
): Promise<{ ok: true; preview: BoardAskPreview } | { ok: false; issues: Issue[] }> {
  try {
    const preview = await previewBoardAskContext(getDb(), projectId, boardId);
    return { ok: true, preview };
  } catch (error) {
    return failure(error);
  }
}
