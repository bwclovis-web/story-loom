import type { DbOrTx } from "../db";
import type { RecordPlacement } from "@/world/inspectorModel";

/** Boards and maps that store this record on a card or pin. Notes are not records. */
export async function listRecordPlacements(db: DbOrTx, projectId: string, recordId: string): Promise<RecordPlacement[]> {
  const [cards, pins] = await Promise.all([
    db.boardCard.findMany({
      where: { projectId, recordId, kind: { in: ["record", "image"] } },
      orderBy: [{ board: { title: "asc" } }, { id: "asc" }],
      select: { id: true, board: { select: { id: true, title: true } } },
    }),
    db.worldMapPin.findMany({
      where: { projectId, recordId, map: { image: { record: { trashedAt: null } } } },
      orderBy: [{ map: { title: "asc" } }, { id: "asc" }],
      select: { id: true, map: { select: { id: true, title: true } } },
    }),
  ]);
  return [
    ...cards.map((card) => ({
      surface: "board" as const,
      surfaceId: card.board.id,
      surfaceTitle: card.board.title,
      itemId: card.id,
    })),
    ...pins.map((pin) => ({
      surface: "map" as const,
      surfaceId: pin.map.id,
      surfaceTitle: pin.map.title,
      itemId: pin.id,
    })),
  ];
}
