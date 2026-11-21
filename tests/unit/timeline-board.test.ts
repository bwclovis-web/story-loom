import { describe, expect, it } from "vitest";
import { buildTimelineBoard, referenceLane, type TimelineBoardEvent } from "@/world/timelineBoard";

function event(id: string, orderIndex: number, dateKey: number | null, title = id, summary = ""): TimelineBoardEvent {
  return { id, title, summary, dateKey, orderIndex };
}

describe("timeline board", () => {
  it("classifies dossiers, organizations, and places", () => {
    expect(referenceLane("character_dossier", {})?.kind).toBe("character");
    expect(referenceLane("worldbuilding", { kind: "organization" })?.kind).toBe("faction");
    expect(referenceLane("worldbuilding", { kind: "place" })).toEqual({ kind: "location", place: true });
    expect(referenceLane("worldbuilding", { kind: "culture" })).toBeNull();
  });

  it("uses structured dates when any event has one, and recorded order otherwise", () => {
    const dated = buildTimelineBoard({
      events: [event("early", 1, 20_000), event("late", 0, 40_000), event("open", 2, null)],
      links: [],
      reveals: [],
      edges: [],
    });
    expect(dated.mode).toBe("date");
    const early = dated.marks.find((mark) => mark.eventId === "early")!;
    const late = dated.marks.find((mark) => mark.eventId === "late")!;
    const open = dated.marks.find((mark) => mark.eventId === "open")!;
    expect(early.x).toBeLessThan(late.x);
    expect(open.axis).toBe("order");
    expect(open.x).toBeGreaterThan(late.x);

    const ordered = buildTimelineBoard({
      events: [event("second", 1, null), event("first", 0, null)],
      links: [],
      reveals: [],
      edges: [],
    });
    expect(ordered.mode).toBe("order");
    const first = ordered.marks.find((mark) => mark.eventId === "first")!;
    const second = ordered.marks.find((mark) => mark.eventId === "second")!;
    expect(first.x).toBeLessThan(second.x);
  });

  it("shows an age from an explicit birth event and warns when a date is earlier", () => {
    const board = buildTimelineBoard({
      events: [
        event("birth", 0, 10_000, "Mara's birth"),
        event("pact", 1, 130_000, "The pact"),
        event("too-soon", 2, 5_000, "The rumor"),
      ],
      links: [
        { eventId: "birth", recordId: "mara", title: "Mara", laneKind: "character", place: false },
        { eventId: "pact", recordId: "mara", title: "Mara", laneKind: "character", place: false },
        { eventId: "too-soon", recordId: "mara", title: "Mara", laneKind: "character", place: false },
      ],
      reveals: [],
      edges: [],
    });
    const pact = board.marks.find((mark) => mark.eventId === "pact" && mark.laneId === "mara")!;
    expect(pact.ageYears).toBe(12);
    expect(pact.ageName).toBe("Mara");
    expect(board.marks.find((mark) => mark.eventId === "birth")!.ageYears).toBeNull();
    expect(board.warnings).toContainEqual({ kind: "before_birth", character: "Mara", birthTitle: "Mara's birth" });
  });

  it("warns when one character is in two places on the same date", () => {
    const board = buildTimelineBoard({
      events: [event("dawn", 0, 30_000, "Dawn")],
      links: [
        { eventId: "dawn", recordId: "mara", title: "Mara", laneKind: "character", place: false },
        { eventId: "dawn", recordId: "quay", title: "The Quay", laneKind: "location", place: true },
        { eventId: "dawn", recordId: "keep", title: "The Keep", laneKind: "location", place: true },
      ],
      reveals: [],
      edges: [],
    });
    expect(board.warnings).toContainEqual({ kind: "same_date", character: "Mara", places: ["The Quay", "The Keep"] });
  });

  it("warns when a later event is revealed first unless a title says Flashback", () => {
    const events = [event("earlier", 0, 10_000, "The oath"), event("later", 1, 20_000, "The break")];
    const edges = [{ earlierId: "earlier", laterId: "later" }];
    const open = buildTimelineBoard({
      events,
      links: [],
      reveals: [
        { eventId: "later", recordId: "ch1", title: "Chapter 1", bookIndex: 0, draftId: "draft" },
        { eventId: "earlier", recordId: "ch2", title: "Chapter 2", bookIndex: 1, draftId: "draft" },
      ],
      edges,
    });
    expect(open.warnings).toContainEqual({ kind: "reveal_order", earlierTitle: "The oath", laterTitle: "The break" });

    const tagged = buildTimelineBoard({
      events,
      links: [],
      reveals: [
        { eventId: "later", recordId: "ch1", title: "Flashback: the break", bookIndex: 0, draftId: "draft" },
        { eventId: "earlier", recordId: "ch2", title: "Chapter 2", bookIndex: 1, draftId: "draft" },
      ],
      edges,
    });
    expect(tagged.warnings.filter((warning) => warning.kind === "reveal_order")).toEqual([]);
  });
});
