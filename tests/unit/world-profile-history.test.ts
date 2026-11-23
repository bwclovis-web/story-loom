import { describe, expect, it } from "vitest";
import type { NarrativePoint } from "@/domain/characterDevelopment";
import {
  emptyWorldProfile,
  readWorldProfile,
  withWorldProfile,
  worldProfileWriteProblems,
  type WorldFieldHistoryChange,
  type WorldProfile,
} from "@/domain/worldProfile";
import {
  appendWorldFieldChange,
  compareWorldFieldsAtPoints,
  redactWorldFieldHistoryForExport,
  resolveWorldFieldsAtPoint,
  supersedeWorldFieldChange,
  visibleWorldFieldHistory,
} from "@/domain/worldProfileHistory";
import type { OrderEdge } from "@/world/storyOrder";

const BOOKS = [
  { projectId: "book1", narrativeIndex: 0 },
  { projectId: "book2", narrativeIndex: 1 },
  { projectId: "book3", narrativeIndex: 2 },
];

function change(partial: Partial<WorldFieldHistoryChange> & Pick<WorldFieldHistoryChange, "id" | "fieldPath">): WorldFieldHistoryChange {
  return {
    definitionId: "category:locations",
    storage: "profile",
    presence: "set",
    value: null,
    approval: "approved",
    planned: false,
    provenance: { origin: "author", note: "" },
    bookProjectId: "book1",
    storyEventId: null,
    chapterRecordId: null,
    sceneRecordId: null,
    sequence: null,
    worldScope: "series",
    note: "",
    supersedesId: null,
    correctionNote: "",
    correctedAt: null,
    ...partial,
  };
}

function profileWith(history: WorldFieldHistoryChange[]): WorldProfile {
  return { ...emptyWorldProfile(), definitionId: "category:locations", fieldHistory: history };
}

describe("world profile field history", () => {
  it("reads missing fieldHistory as empty and preserves undated current separately", () => {
    const read = readWorldProfile({
      climate: "temperate",
      worldProfile: {
        version: 1,
        values: { access: "east entrance closed" },
      },
    });
    expect(read.ok).toBe(true);
    expect(read.profile.fieldHistory).toEqual([]);
    expect(read.profile.values.access).toBe("east entrance closed");
  });

  it("undated current alone resolves as unknown at an earlier point", () => {
    const profile = {
      ...emptyWorldProfile(),
      values: { access: "east entrance closed" },
      fieldHistory: [],
    };
    const point: NarrativePoint = {
      bookProjectId: "book1",
      storyEventId: "ev_early",
      sequence: null,
      boundary: "at_point",
    };
    const resolved = resolveWorldFieldsAtPoint(profile, point, [], {
      books: BOOKS,
      fieldPaths: ["values.access"],
    });
    expect(resolved.fields["values.access"]?.presence).toBe("unknown");
  });

  it("resolves series station open then closed across books", () => {
    const edges: OrderEdge[] = [
      { earlierId: "ev_open", laterId: "ev_close" },
    ];
    const profile = profileWith([
      change({
        id: "wfh_open",
        fieldPath: "values.access",
        value: "open",
        bookProjectId: "book1",
        storyEventId: "ev_open",
      }),
      change({
        id: "wfh_close",
        fieldPath: "values.access",
        value: "closed",
        bookProjectId: "book2",
        storyEventId: "ev_close",
      }),
    ]);

    const bookOne = resolveWorldFieldsAtPoint(
      profile,
      { bookProjectId: "book1", storyEventId: "ev_open", sequence: null, boundary: "at_point" },
      edges,
      { books: BOOKS, fieldPaths: ["values.access"] },
    );
    expect(bookOne.fields["values.access"]).toMatchObject({
      presence: "set",
      formatted: "open",
      changeId: "wfh_open",
    });

    const atClose = resolveWorldFieldsAtPoint(
      profile,
      { bookProjectId: "book2", storyEventId: "ev_close", sequence: null, boundary: "at_point" },
      edges,
      { books: BOOKS, fieldPaths: ["values.access"] },
    );
    expect(atClose.fields["values.access"]).toMatchObject({
      presence: "set",
      formatted: "closed",
      changeId: "wfh_close",
    });
  });

  it("flashback before closure stays open; planned reopen is excluded from approved as-of", () => {
    const edges: OrderEdge[] = [
      { earlierId: "ev_open", laterId: "ev_close" },
      { earlierId: "ev_close", laterId: "ev_reopen" },
    ];
    const profile = profileWith([
      change({
        id: "wfh_open",
        fieldPath: "values.access",
        value: "open",
        bookProjectId: "book1",
        storyEventId: "ev_open",
      }),
      change({
        id: "wfh_close",
        fieldPath: "values.access",
        value: "closed",
        bookProjectId: "book2",
        storyEventId: "ev_close",
      }),
      change({
        id: "wfh_reopen",
        fieldPath: "values.access",
        value: "reopened",
        bookProjectId: "book3",
        storyEventId: "ev_reopen",
        planned: true,
        approval: "proposed",
      }),
    ]);

    const flashback = resolveWorldFieldsAtPoint(
      profile,
      {
        bookProjectId: "book2",
        storyEventId: "ev_open",
        sceneRecordId: "sc_flashback",
        sequence: null,
        boundary: "at_point",
      },
      edges,
      { books: BOOKS, fieldPaths: ["values.access"] },
    );
    expect(flashback.fields["values.access"]).toMatchObject({
      presence: "set",
      formatted: "open",
      changeId: "wfh_open",
    });

    const afterClose = resolveWorldFieldsAtPoint(
      profile,
      { bookProjectId: "book2", storyEventId: "ev_close", sequence: null, boundary: "at_point" },
      edges,
      { books: BOOKS, fieldPaths: ["values.access"] },
    );
    expect(afterClose.fields["values.access"]?.presence).toBe("set");
    if (afterClose.fields["values.access"]?.presence === "set") {
      expect(afterClose.fields["values.access"].formatted).toBe("closed");
    }
  });

  it("baseline clears knowledge and compare reports diffs", () => {
    const profile = profileWith([
      change({
        id: "wfh_open",
        fieldPath: "values.access",
        value: "open",
        bookProjectId: "book1",
        storyEventId: "ev_open",
      }),
    ]);
    const comparison = compareWorldFieldsAtPoints(
      profile,
      { bookProjectId: "book1", storyEventId: null, sequence: null, boundary: "baseline" },
      { bookProjectId: "book1", storyEventId: "ev_open", sequence: null, boundary: "at_point" },
      [],
      { books: BOOKS, fieldPaths: ["values.access"] },
    );
    expect(comparison.diffs[0]?.kind).toBe("added");
  });

  it("supersede marks prior change and appends replacement", () => {
    const profile = profileWith([
      change({
        id: "wfh_close",
        fieldPath: "values.access",
        value: "closed",
        bookProjectId: "book2",
        storyEventId: "ev_close",
      }),
    ]);
    const result = supersedeWorldFieldChange(
      profile,
      "wfh_close",
      {
        fieldPath: "values.access",
        definitionId: "category:locations",
        storage: "profile",
        presence: "set",
        value: "sealed",
        approval: "approved",
        planned: false,
        provenance: { origin: "author", note: "" },
        bookProjectId: "book2",
        storyEventId: "ev_close",
        chapterRecordId: null,
        sceneRecordId: null,
        sequence: null,
        worldScope: "series",
        note: "",
        correctionNote: "Stronger wording",
        correctedAt: null,
      },
      () => "wfh_sealed",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profile.fieldHistory.find((c) => c.id === "wfh_close")?.approval).toBe("superseded");
    const resolved = resolveWorldFieldsAtPoint(
      result.profile,
      { bookProjectId: "book2", storyEventId: "ev_close", sequence: null, boundary: "at_point" },
      [],
      { books: BOOKS, fieldPaths: ["values.access"] },
    );
    expect(resolved.fields["values.access"]).toMatchObject({
      formatted: "sealed",
      changeId: "wfh_sealed",
    });
  });

  it("hides book-scoped changes from another book", () => {
    const profile = profileWith([
      change({
        id: "wfh_local",
        fieldPath: "values.access",
        value: "book-two only",
        bookProjectId: "book2",
        worldScope: "book",
        storyEventId: "ev_close",
      }),
    ]);
    expect(visibleWorldFieldHistory(profile, "book1")).toEqual([]);
    expect(visibleWorldFieldHistory(profile, "book2")).toHaveLength(1);
  });

  it("redacts planned and future history for export", () => {
    const edges: OrderEdge[] = [{ earlierId: "ev_open", laterId: "ev_close" }];
    const profile = profileWith([
      change({
        id: "wfh_open",
        fieldPath: "values.access",
        value: "open",
        bookProjectId: "book1",
        storyEventId: "ev_open",
      }),
      change({
        id: "wfh_close",
        fieldPath: "values.access",
        value: "closed",
        bookProjectId: "book2",
        storyEventId: "ev_close",
      }),
      change({
        id: "wfh_draft",
        fieldPath: "values.access",
        value: "maybe",
        approval: "draft",
        bookProjectId: "book1",
        storyEventId: "ev_open",
      }),
    ]);
    const redacted = redactWorldFieldHistoryForExport(
      profile,
      { bookProjectId: "book1", storyEventId: "ev_open", sequence: null, boundary: "at_point" },
      edges,
      { books: BOOKS, viewingProjectId: "book1" },
    );
    expect(redacted.fieldHistory.map((c) => c.id)).toEqual(["wfh_open"]);
  });

  it("rejects invalid supersedesId and non-array fieldHistory on write", () => {
    expect(
      worldProfileWriteProblems({
        version: 1,
        fieldHistory: { bad: true },
      }).some((p) => p.path.includes("fieldHistory")),
    ).toBe(true);

    const bad = worldProfileWriteProblems({
      version: 1,
      fieldHistory: [
        change({
          id: "wfh_a",
          fieldPath: "values.access",
          value: "x",
          supersedesId: "missing",
        }),
      ],
    });
    expect(bad.some((p) => p.message.includes("supersedes unknown"))).toBe(true);
  });

  it("round-trips fieldHistory inside withWorldProfile", () => {
    let profile = emptyWorldProfile();
    profile = appendWorldFieldChange(
      profile,
      change({
        id: "wfh_climate",
        fieldPath: "fields.climate",
        storage: "flat",
        value: "arid",
        bookProjectId: "book1",
        storyEventId: "ev_open",
      }),
    );
    const fields = withWorldProfile({ climate: "temperate" }, profile);
    const read = readWorldProfile(fields);
    expect(read.ok).toBe(true);
    expect(read.profile.fieldHistory).toHaveLength(1);
    expect(read.profile.fieldHistory[0]?.fieldPath).toBe("fields.climate");
    expect(fields.climate).toBe("temperate");
  });
});
