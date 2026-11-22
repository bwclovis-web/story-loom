import { describe, expect, it } from "vitest";
import {
  boardFilterState,
  centerScroll,
  dragExceeded,
  gestureForBoardPointer,
  mergeBoardCards,
  rememberNoteDraft,
  shouldWriteMove,
  spatialChangeAllowed,
  type BoardCardSnapshot,
} from "@/world/boardInteraction";

function card(partial: Partial<BoardCardSnapshot> & Pick<BoardCardSnapshot, "id" | "kind">): BoardCardSnapshot {
  return {
    x: 10,
    y: 20,
    width: 180,
    height: 120,
    noteTitle: "",
    noteBody: "",
    label: partial.id,
    ...partial,
  };
}

describe("board interaction", () => {
  it("locks movement and resizing, and a short press does not drag", () => {
    expect(spatialChangeAllowed(true)).toEqual({ move: false, resize: false });
    expect(spatialChangeAllowed(false)).toEqual({ move: true, resize: true });
    expect(dragExceeded(2, 2)).toBe(false);
    expect(dragExceeded(5, 0)).toBe(true);
    expect(
      gestureForBoardPointer({
        tool: "select",
        locked: true,
        onHandle: true,
        onCard: true,
        editingText: false,
        exceeded: true,
      }),
    ).toBe("select");
    expect(
      gestureForBoardPointer({
        tool: "select",
        locked: false,
        onHandle: true,
        onCard: true,
        editingText: false,
        exceeded: false,
      }),
    ).toBe("select");
    expect(
      gestureForBoardPointer({
        tool: "select",
        locked: false,
        onHandle: true,
        onCard: true,
        editingText: false,
        exceeded: true,
      }),
    ).toBe("move");
  });

  it("does not move a card from the body, from Pan, or while editing text", () => {
    expect(
      gestureForBoardPointer({
        tool: "select",
        locked: false,
        onHandle: false,
        onCard: true,
        editingText: false,
        exceeded: true,
      }),
    ).toBe("select");
    expect(
      gestureForBoardPointer({
        tool: "pan",
        locked: false,
        onHandle: true,
        onCard: false,
        editingText: false,
        exceeded: true,
      }),
    ).toBe("pan");
    expect(
      gestureForBoardPointer({
        tool: "select",
        locked: false,
        onHandle: true,
        onCard: true,
        editingText: true,
        exceeded: true,
      }),
    ).toBe("select");
    expect(shouldWriteMove({ exceeded: false, cancelled: false, locked: false })).toBe(false);
    expect(shouldWriteMove({ exceeded: true, cancelled: true, locked: false })).toBe(false);
    expect(shouldWriteMove({ exceeded: true, cancelled: false, locked: true })).toBe(false);
    expect(shouldWriteMove({ exceeded: true, cancelled: false, locked: false })).toBe(true);
  });

  it("keeps every unsaved note across a refresh and leaves saved notes alone", () => {
    const saved = card({ id: "note-a", kind: "note", noteTitle: "Quay", noteBody: "Saved", label: "Quay", x: 40, y: 50 });
    const other = card({ id: "note-b", kind: "note", noteTitle: "Ridge", noteBody: "Cold", label: "Ridge" });
    let drafts = rememberNoteDraft({}, "note-a", { title: "Quay", body: "Sheltered" }, { title: "Quay", body: "Saved" });
    drafts = rememberNoteDraft(drafts, "note-b", { title: "Ridge", body: "Cold" }, { title: "Ridge", body: "Cold" });
    const local = [
      { ...saved, x: 90, y: 70, noteBody: "Sheltered" },
      other,
    ];
    const merged = mergeBoardCards([saved, other], local, drafts);
    expect(merged[0]).toMatchObject({ x: 90, y: 70, noteBody: "Sheltered", label: "Quay" });
    expect(merged[1]).toMatchObject({ noteTitle: "Ridge", noteBody: "Cold" });
    expect(drafts["note-b"]).toBeUndefined();
  });

  it("centers cards without a zoom and explains a filter that hides every card", () => {
    expect(
      centerScroll({ clientWidth: 200, clientHeight: 100 }, [{ x: 450, y: 375, width: 100, height: 50 }]),
    ).toEqual({ left: 400, top: 350 });
    expect(centerScroll({ clientWidth: 200, clientHeight: 100 }, [])).toBeNull();
    expect(boardFilterState(0, 0)).toBe("empty");
    expect(boardFilterState(4, 0)).toBe("hidden");
    expect(boardFilterState(4, 2)).toBe("shown");
  });
});
