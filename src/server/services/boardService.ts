import type { WorldScope } from "@/domain/assignments";
import { newId } from "@/domain/ids";
import { errorIssue } from "@/domain/issues";
import { isLinkableReferenceType, isRecordType, RECORD_TYPE_LABELS } from "@/domain/recordTypes";
import { worldKindDisplayFromFields } from "@/world/worldKinds";
import { isAuthorityStatus, type AuthorityStatus } from "@/domain/statuses";
import type { SeriesHomeRef } from "@/world/seriesHome";
import type { Db, DbOrTx, Tx } from "../db";
import { writeAudit } from "./auditService";
import { MutationRejectedError, NotFoundError } from "./errors";
import { resolveAvailableImage } from "./imageService";
import { listSeriesBookProjects } from "./projectService";
import { resolveAvailableReference } from "./seriesBibleService";

/*
 * World boards: place record/image cards and freeform notes. Positions and
 * source links are board-local metadata (not revisioned). Removing a card only
 * removes it from that board. The same record may appear on several boards.
 */

const UI_ACTOR = "author";

export const BOARD_TEMPLATES = ["blank", "geography"] as const;
export type BoardTemplateKey = (typeof BOARD_TEMPLATES)[number];

export const BOARD_CARD_KINDS = ["record", "image", "note"] as const;
export type BoardCardKind = (typeof BOARD_CARD_KINDS)[number];

export function isBoardTemplateKey(v: string): v is BoardTemplateKey {
  return (BOARD_TEMPLATES as readonly string[]).includes(v);
}

export function isBoardCardKind(v: string): v is BoardCardKind {
  return (BOARD_CARD_KINDS as readonly string[]).includes(v);
}

export interface BoardSummary {
  id: string;
  title: string;
  templateKey: BoardTemplateKey;
  cardCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface BoardCardView {
  id: string;
  boardId: string;
  kind: BoardCardKind;
  recordId: string | null;
  imageId: string | null;
  noteTitle: string;
  noteBody: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  /** Display title for the card face. */
  label: string;
  recordTitle: string | null;
  recordTypeLabel: string | null;
  recordWorldKindLabel: string | null;
  authorityStatus: AuthorityStatus | null;
  imageName: string | null;
  imageAlt: string | null;
  /** Home book when the card targets a series-shared sibling reference. */
  home: SeriesHomeRef | null;
  worldScope: WorldScope | null;
  /** True when the linked record/image is trashed, unshared, or left the series. */
  unavailable: boolean;
}

export interface BoardView {
  id: string;
  projectId: string;
  title: string;
  templateKey: BoardTemplateKey;
  createdAt: Date;
  updatedAt: Date;
  cards: BoardCardView[];
}

function rejected(message: string, recordId?: string): MutationRejectedError {
  return new MutationRejectedError([errorIssue("INVALID_REFERENCE", message, recordId ? { recordId } : {})]);
}

/** Invented geography regions for the editable template (fixture-friendly). */
export const GEOGRAPHY_TEMPLATE_NOTES: ReadonlyArray<{
  noteTitle: string;
  noteBody: string;
  x: number;
  y: number;
  width: number;
  height: number;
}> = [
  {
    noteTitle: "North ridge",
    noteBody: "High ground above the salt flats. Roads thin to tracks.",
    x: 280,
    y: 40,
    width: 200,
    height: 110,
  },
  {
    noteTitle: "Salt flats",
    noteBody: "Wide white plain west of the harbour. Mirages at noon.",
    x: 40,
    y: 160,
    width: 220,
    height: 130,
  },
  {
    noteTitle: "Harbour quay",
    noteBody: "South waterfront. Lantern alley opens inland from the docks.",
    x: 300,
    y: 300,
    width: 240,
    height: 130,
  },
  {
    noteTitle: "Inland hills",
    noteBody: "East of the high road. Farmsteads and windbreaks.",
    x: 560,
    y: 140,
    width: 200,
    height: 120,
  },
];

function cardLabel(kind: BoardCardKind, opts: { recordTitle?: string | null; imageName?: string | null; noteTitle?: string }): string {
  if (kind === "note") return opts.noteTitle?.trim() || "Note";
  if (kind === "image") return opts.imageName || opts.recordTitle || "Image";
  return opts.recordTitle || "Record";
}

async function touchBoard(tx: Tx, boardId: string) {
  await tx.board.update({ where: { id: boardId }, data: { updatedAt: new Date() } });
}

export async function listBoards(db: DbOrTx, projectId: string): Promise<BoardSummary[]> {
  const rows = await db.board.findMany({
    where: { projectId },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    include: { _count: { select: { cards: true } } },
  });
  return rows.flatMap((b) =>
    isBoardTemplateKey(b.templateKey)
      ? [
          {
            id: b.id,
            title: b.title,
            templateKey: b.templateKey,
            cardCount: b._count.cards,
            createdAt: b.createdAt,
            updatedAt: b.updatedAt,
          },
        ]
      : [],
  );
}

export async function getBoard(db: DbOrTx, projectId: string, boardId: string): Promise<BoardView> {
  const board = await db.board.findFirst({
    where: { id: boardId, projectId },
    include: {
      cards: {
        orderBy: [{ zIndex: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        include: {
          record: {
            select: {
              id: true,
              projectId: true,
              title: true,
              type: true,
              authorityStatus: true,
              trashedAt: true,
              fields: true,
              worldScope: true,
            },
          },
          image: { select: { id: true, name: true, altText: true, recordId: true } },
        },
      },
    },
  });
  if (!board || !isBoardTemplateKey(board.templateKey)) throw new NotFoundError(`Board ${boardId} not found`);

  const linkedRecordIds = [
    ...new Set(
      board.cards.flatMap((c) => {
        if (c.recordId) return [c.recordId];
        if (c.image?.recordId) return [c.image.recordId];
        return [];
      }),
    ),
  ];
  const availability = new Map(
    await Promise.all(
      linkedRecordIds.map(async (id) => [id, await resolveAvailableReference(db, projectId, id)] as const),
    ),
  );
  const seriesBooks = await listSeriesBookProjects(db, projectId);
  const homeByProject = new Map(
    seriesBooks.map((book) => [book.id, { projectId: book.id, title: book.title, bookName: book.bookName } as SeriesHomeRef]),
  );

  const cards: BoardCardView[] = board.cards.flatMap((c) => {
    if (!isBoardCardKind(c.kind)) return [];
    const targetRecordId = c.recordId ?? c.image?.recordId ?? null;
    const available = targetRecordId ? availability.get(targetRecordId) ?? null : null;
    const unavailable = Boolean(targetRecordId) && !available && c.kind !== "note";
    const liveRecord = available
      ? {
          id: available.record.id,
          title: available.record.title,
          type: available.record.type,
          authorityStatus: available.record.authorityStatus,
          fields: available.record.fields,
          worldScope: available.worldScope,
        }
      : c.record && c.record.trashedAt === null && isRecordType(c.record.type)
        ? c.record
        : null;
    const typeLabel =
      liveRecord && isRecordType(liveRecord.type) ? RECORD_TYPE_LABELS[liveRecord.type] : null;
    const worldKindLabel =
      liveRecord?.type === "worldbuilding" ? worldKindDisplayFromFields(liveRecord.fields) : null;
    const status =
      liveRecord && isAuthorityStatus(liveRecord.authorityStatus) ? liveRecord.authorityStatus : null;
    const home: SeriesHomeRef | null =
      available?.home ??
      (unavailable && c.record && c.record.projectId !== projectId
        ? homeByProject.get(c.record.projectId) ?? null
        : null);
    return [
      {
        id: c.id,
        boardId: c.boardId,
        kind: c.kind,
        recordId: c.recordId,
        imageId: c.imageId,
        noteTitle: c.noteTitle,
        noteBody: c.noteBody,
        x: c.x,
        y: c.y,
        width: c.width,
        height: c.height,
        zIndex: c.zIndex,
        label: cardLabel(c.kind, {
          recordTitle: liveRecord?.title ?? (unavailable ? c.record?.title ?? null : null),
          imageName: c.image?.name ?? null,
          noteTitle: c.noteTitle,
        }),
        recordTitle: liveRecord?.title ?? (unavailable ? c.record?.title ?? null : null),
        recordTypeLabel: typeLabel,
        recordWorldKindLabel: worldKindLabel,
        authorityStatus: status,
        imageName: c.image?.name ?? null,
        imageAlt: c.image?.altText ?? null,
        home,
        worldScope: available?.worldScope ?? (c.record?.worldScope === "series" || c.record?.worldScope === "book" ? c.record.worldScope : null),
        unavailable,
      },
    ];
  });

  return {
    id: board.id,
    projectId: board.projectId,
    title: board.title,
    templateKey: board.templateKey,
    createdAt: board.createdAt,
    updatedAt: board.updatedAt,
    cards,
  };
}

export async function createBoard(
  db: Db,
  projectId: string,
  input: { title: string; templateKey: BoardTemplateKey },
): Promise<BoardView> {
  const title = input.title.trim();
  if (!title) throw rejected("Give the board a title.");
  if (!isBoardTemplateKey(input.templateKey)) throw rejected("Unknown board template.");

  return db.$transaction(async (tx) => {
    const project = await tx.project.findFirst({ where: { id: projectId, trashedAt: null }, select: { id: true } });
    if (!project) throw new NotFoundError(`Project ${projectId} not found`);

    const id = newId("brd");
    await tx.board.create({
      data: {
        id,
        projectId,
        title,
        templateKey: input.templateKey,
      },
    });

    if (input.templateKey === "geography") {
      for (const [i, note] of GEOGRAPHY_TEMPLATE_NOTES.entries()) {
        await tx.boardCard.create({
          data: {
            id: newId("bcd"),
            boardId: id,
            projectId,
            kind: "note",
            noteTitle: note.noteTitle,
            noteBody: note.noteBody,
            x: note.x,
            y: note.y,
            width: note.width,
            height: note.height,
            zIndex: i,
          },
        });
      }
    }

    await writeAudit(tx, {
      projectId,
      action: "board.create",
      actor: UI_ACTOR,
      summary: `Created board "${title}" (${input.templateKey})`,
      details: { boardId: id, templateKey: input.templateKey },
    });

    return getBoard(tx, projectId, id);
  });
}

export async function renameBoard(db: Db, projectId: string, boardId: string, title: string): Promise<BoardView> {
  const next = title.trim();
  if (!next) throw rejected("Give the board a title.");
  return db.$transaction(async (tx) => {
    const board = await tx.board.findFirst({ where: { id: boardId, projectId } });
    if (!board) throw new NotFoundError(`Board ${boardId} not found`);
    await tx.board.update({ where: { id: boardId }, data: { title: next } });
    await writeAudit(tx, {
      projectId,
      action: "board.rename",
      actor: UI_ACTOR,
      summary: `Renamed board to "${next}"`,
      details: { boardId, title: next },
    });
    return getBoard(tx, projectId, boardId);
  });
}

export async function deleteBoard(db: Db, projectId: string, boardId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    const board = await tx.board.findFirst({ where: { id: boardId, projectId } });
    if (!board) throw new NotFoundError(`Board ${boardId} not found`);
    await tx.boardCard.deleteMany({ where: { boardId } });
    await tx.board.delete({ where: { id: boardId } });
    await writeAudit(tx, {
      projectId,
      action: "board.delete",
      actor: UI_ACTOR,
      summary: `Deleted board "${board.title}"`,
      details: { boardId },
    });
  });
}

export async function addRecordCard(
  db: Db,
  projectId: string,
  boardId: string,
  input: { recordId: string; x: number; y: number },
): Promise<BoardCardView> {
  return db.$transaction(async (tx) => {
    await requireBoard(tx, projectId, boardId);
    const available = await resolveAvailableReference(tx, projectId, input.recordId);
    if (!available) throw rejected("That record is not available in this book.", input.recordId);
    if (!isLinkableReferenceType(available.record.type)) {
      throw rejected("Only reference records can be placed on a board.", input.recordId);
    }
    const z = await nextZ(tx, boardId);
    const id = newId("bcd");
    await tx.boardCard.create({
      data: {
        id,
        boardId,
        projectId,
        kind: "record",
        recordId: available.record.id,
        x: Math.round(input.x),
        y: Math.round(input.y),
        zIndex: z,
      },
    });
    await touchBoard(tx, boardId);
    await writeAudit(tx, {
      projectId,
      action: "board_card.add",
      actor: UI_ACTOR,
      summary: `Added "${available.record.title}" to a board`,
      details: { boardId, cardId: id, kind: "record", recordId: available.record.id },
    });
    const board = await getBoard(tx, projectId, boardId);
    return board.cards.find((c) => c.id === id)!;
  });
}

export async function addImageCard(
  db: Db,
  projectId: string,
  boardId: string,
  input: { imageId: string; x: number; y: number },
): Promise<BoardCardView> {
  return db.$transaction(async (tx) => {
    await requireBoard(tx, projectId, boardId);
    const image = await resolveAvailableImage(tx, projectId, input.imageId);
    if (!image) throw rejected("That image is not available in this book.");
    const z = await nextZ(tx, boardId);
    const id = newId("bcd");
    await tx.boardCard.create({
      data: {
        id,
        boardId,
        projectId,
        kind: "image",
        imageId: image.id,
        recordId: image.recordId,
        x: Math.round(input.x),
        y: Math.round(input.y),
        width: 240,
        height: 200,
        zIndex: z,
      },
    });
    await touchBoard(tx, boardId);
    await writeAudit(tx, {
      projectId,
      action: "board_card.add",
      actor: UI_ACTOR,
      summary: `Added image "${image.name}" to a board`,
      details: { boardId, cardId: id, kind: "image", imageId: image.id, recordId: image.recordId },
    });
    const board = await getBoard(tx, projectId, boardId);
    return board.cards.find((c) => c.id === id)!;
  });
}

export async function addNoteCard(
  db: Db,
  projectId: string,
  boardId: string,
  input: { noteTitle?: string; noteBody?: string; x: number; y: number },
): Promise<BoardCardView> {
  return db.$transaction(async (tx) => {
    await requireBoard(tx, projectId, boardId);
    const z = await nextZ(tx, boardId);
    const id = newId("bcd");
    const noteTitle = (input.noteTitle ?? "Note").trim() || "Note";
    const noteBody = input.noteBody ?? "";
    await tx.boardCard.create({
      data: {
        id,
        boardId,
        projectId,
        kind: "note",
        noteTitle,
        noteBody,
        x: Math.round(input.x),
        y: Math.round(input.y),
        zIndex: z,
      },
    });
    await touchBoard(tx, boardId);
    await writeAudit(tx, {
      projectId,
      action: "board_card.add",
      actor: UI_ACTOR,
      summary: `Added a note to a board`,
      details: { boardId, cardId: id, kind: "note" },
    });
    const board = await getBoard(tx, projectId, boardId);
    return board.cards.find((c) => c.id === id)!;
  });
}

export async function moveBoardCard(
  db: Db,
  projectId: string,
  boardId: string,
  cardId: string,
  input: { x: number; y: number; width?: number; height?: number; zIndex?: number },
): Promise<BoardCardView> {
  return db.$transaction(async (tx) => {
    await requireBoard(tx, projectId, boardId);
    const card = await tx.boardCard.findFirst({ where: { id: cardId, boardId, projectId } });
    if (!card) throw rejected("That card is not on this board.");
    await tx.boardCard.update({
      where: { id: cardId },
      data: {
        x: Math.round(input.x),
        y: Math.round(input.y),
        ...(typeof input.width === "number" ? { width: Math.max(120, Math.round(input.width)) } : {}),
        ...(typeof input.height === "number" ? { height: Math.max(80, Math.round(input.height)) } : {}),
        ...(typeof input.zIndex === "number" ? { zIndex: input.zIndex } : {}),
      },
    });
    await touchBoard(tx, boardId);
    await writeAudit(tx, {
      projectId,
      action: "board_card.move",
      actor: UI_ACTOR,
      summary: `Moved a board card`,
      details: { boardId, cardId, x: input.x, y: input.y },
    });
    const board = await getBoard(tx, projectId, boardId);
    return board.cards.find((c) => c.id === cardId)!;
  });
}

export async function updateNoteCard(
  db: Db,
  projectId: string,
  boardId: string,
  cardId: string,
  input: { noteTitle: string; noteBody: string },
): Promise<BoardCardView> {
  return db.$transaction(async (tx) => {
    await requireBoard(tx, projectId, boardId);
    const card = await tx.boardCard.findFirst({ where: { id: cardId, boardId, projectId } });
    if (!card || card.kind !== "note") throw rejected("That note is not on this board.");
    await tx.boardCard.update({
      where: { id: cardId },
      data: { noteTitle: input.noteTitle.trim() || "Note", noteBody: input.noteBody },
    });
    await touchBoard(tx, boardId);
    await writeAudit(tx, {
      projectId,
      action: "board_card.update",
      actor: UI_ACTOR,
      summary: `Updated a board note`,
      details: { boardId, cardId },
    });
    const board = await getBoard(tx, projectId, boardId);
    return board.cards.find((c) => c.id === cardId)!;
  });
}

/** Removes the card from this board only; does not change the source record or image. */
export async function removeBoardCard(db: Db, projectId: string, boardId: string, cardId: string): Promise<void> {
  await db.$transaction(async (tx) => {
    await requireBoard(tx, projectId, boardId);
    const card = await tx.boardCard.findFirst({ where: { id: cardId, boardId, projectId } });
    if (!card) throw rejected("That card is not on this board.");
    await tx.boardCard.delete({ where: { id: cardId } });
    await touchBoard(tx, boardId);
    await writeAudit(tx, {
      projectId,
      action: "board_card.remove",
      actor: UI_ACTOR,
      summary: `Removed a card from a board`,
      details: { boardId, cardId, kind: card.kind, recordId: card.recordId, imageId: card.imageId },
    });
  });
}

async function requireBoard(tx: Tx, projectId: string, boardId: string) {
  const board = await tx.board.findFirst({ where: { id: boardId, projectId }, select: { id: true } });
  if (!board) throw new NotFoundError(`Board ${boardId} not found`);
}

async function nextZ(tx: Tx, boardId: string) {
  const max = await tx.boardCard.aggregate({ where: { boardId }, _max: { zIndex: true } });
  return (max._max.zIndex ?? -1) + 1;
}
