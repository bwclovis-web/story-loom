import { describe, expect, it } from "vitest";
import type { NarrativePoint } from "@/domain/characterDevelopment";
import { writingContextPolicy } from "@/domain/characterWritingContext";
import {
  emptyWorldProfile,
  readWorldProfile,
  withWorldProfile,
  type WorldFieldHistoryChange,
  type WorldProfile,
} from "@/domain/worldProfile";
import { WORLD_MARKDOWN_ARCHIVE_KEY } from "@/domain/worldProfileUpgrade";
import {
  redactWorldFieldsForExport,
  renderWorldContextSlice,
} from "@/domain/worldWritingContext";
import type { OrderEdge } from "@/world/storyOrder";

const BOOKS = [
  { projectId: "book1", narrativeIndex: 0 },
  { projectId: "book2", narrativeIndex: 1 },
];

const REOPEN_PHRASE = "REOPEN_PHRASE_DISTINCTIVE_W7A";

function change(
  partial: Partial<WorldFieldHistoryChange> & Pick<WorldFieldHistoryChange, "id" | "fieldPath" | "value">,
): WorldFieldHistoryChange {
  return {
    definitionId: "category:locations",
    storage: "profile",
    presence: "set",
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

function stationProfile(): WorldProfile {
  return {
    ...emptyWorldProfile(),
    definitionId: "category:locations",
    values: { access: "closed" },
    fieldHistory: [
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
        bookProjectId: "book2",
        storyEventId: "ev_close",
        planned: true,
        approval: "proposed",
      }),
      change({
        id: "wfh_book1_local",
        fieldPath: "values.access",
        value: "book1_local_override",
        bookProjectId: "book1",
        storyEventId: "ev_open",
        worldScope: "book",
      }),
    ],
  };
}

function fieldsFor(profile: WorldProfile) {
  return withWorldProfile(
    {
      climate: "coastal fog",
      [WORLD_MARKDOWN_ARCHIVE_KEY]: {
        version: 1,
        entries: [{ id: "wma1", body: REOPEN_PHRASE, bodyHash: "x", sourceRevision: 1, archivedAt: new Date(0).toISOString(), migrationFingerprint: "" }],
        appliedFingerprints: [],
      },
    },
    profile,
  );
}

const edges: OrderEdge[] = [
  { earlierId: "ev_open", laterId: "ev_before" },
  { earlierId: "ev_before", laterId: "ev_close" },
  { earlierId: "ev_close", laterId: "ev_after" },
  { earlierId: "ev_open", laterId: "ev_flashback" },
  { earlierId: "ev_flashback", laterId: "ev_close" },
];

function point(storyEventId: string | null, book = "book2"): NarrativePoint {
  return {
    bookProjectId: book,
    storyEventId,
    sequence: storyEventId ? 1 : null,
    boundary: "at_point",
    chapterRecordId: storyEventId ? "rec_ch" : null,
    sceneRecordId: storyEventId ? "rec_sc" : null,
  };
}

describe("worldWritingContext", () => {
  it("before closure and flashback receive open, never closed or REOPEN_PHRASE", () => {
    const profile = stationProfile();
    const fields = fieldsFor(profile);
    for (const eventId of ["ev_before", "ev_flashback"] as const) {
      const { text, meta } = renderWorldContextSlice({
        title: "Saltmarsh Station",
        recordId: "rec_station",
        body: `## Access [PROPOSED]\n${REOPEN_PHRASE}\n\n## Notes\nQuiet docks.`,
        fields,
        mode: "drafting",
        point: point(eventId),
        edges,
        books: BOOKS,
        viewingProjectId: "book2",
        homeLabel: "Book One",
      });
      expect(text).toContain("open");
      expect(text).not.toContain("closed");
      expect(text).not.toContain(REOPEN_PHRASE);
      expect(text).toContain("objective setting state");
      expect(text).toContain("distinct from what any viewpoint character");
      expect(text.toLowerCase()).toMatch(/unknown.*climate|climate.*unknown/);
      expect(meta.storyPointStatus).toBe("anchored");
      expect(meta.factCount).toBeGreaterThan(0);
    }
  });

  it("at and after closure receive closed and still omit REOPEN_PHRASE", () => {
    const fields = fieldsFor(stationProfile());
    for (const eventId of ["ev_close", "ev_after"] as const) {
      const { text } = renderWorldContextSlice({
        title: "Saltmarsh Station",
        recordId: "rec_station",
        fields,
        mode: "drafting",
        point: point(eventId),
        edges,
        books: BOOKS,
        viewingProjectId: "book2",
      });
      expect(text).toContain("closed");
      expect(text).not.toContain(": open");
      expect(text).not.toContain(REOPEN_PHRASE);
      expect(text).not.toContain("book1_local_override");
    }
  });

  it("unanchored drafting keeps prior-book open and omits Book Two closure", () => {
    const fields = fieldsFor(stationProfile());
    const { text, meta } = renderWorldContextSlice({
      title: "Saltmarsh Station",
      recordId: "rec_station",
      fields,
      mode: "drafting",
      point: { bookProjectId: "book2", storyEventId: null, sequence: null },
      edges,
      books: BOOKS,
      viewingProjectId: "book2",
    });
    expect(meta.storyPointStatus).toBe("unanchored");
    expect(text).toContain("open");
    expect(text).not.toContain(REOPEN_PHRASE);
    // Closure is event-dated in Book Two and unplaced without an anchor.
    expect(text).not.toMatch(/access: closed/);
  });

  it("withholds conflicted chronology and reports ambiguity", () => {
    const profile = {
      ...emptyWorldProfile(),
      definitionId: "category:locations",
      fieldHistory: [
        change({
          id: "wfh_a",
          fieldPath: "values.access",
          value: "open",
          bookProjectId: "book2",
          storyEventId: null,
          sequence: null,
        }),
        change({
          id: "wfh_b",
          fieldPath: "values.access",
          value: "closed",
          bookProjectId: "book2",
          storyEventId: null,
          sequence: null,
        }),
      ],
    };
    const { text, meta } = renderWorldContextSlice({
      title: "Saltmarsh Station",
      recordId: "rec_station",
      fields: withWorldProfile({}, profile),
      mode: "drafting",
      point: { bookProjectId: "book2", storyEventId: null, sequence: null },
      edges: [],
      books: BOOKS,
      viewingProjectId: "book2",
    });
    expect(meta.omittedConflicts).toBeGreaterThan(0);
    expect(text).toMatch(/Ambiguous chronology|ambiguity/i);
    expect(text).not.toMatch(/Settled world facts[\s\S]*access: (open|closed)/);
  });

  it("strips unsettled legacy headings and never emits archive body", () => {
    const fields = fieldsFor(stationProfile());
    const { text } = renderWorldContextSlice({
      title: "Saltmarsh Station",
      recordId: "rec_station",
      body: `## Access [PROPOSED]\nShould not appear.\n\n## Dock notes\nQuiet docks.`,
      fields,
      mode: "drafting",
      point: point("ev_before"),
      edges,
      books: BOOKS,
      viewingProjectId: "book2",
    });
    expect(text).toContain("Quiet docks");
    expect(text).not.toContain("Should not appear");
    expect(text).not.toContain(REOPEN_PHRASE);
    expect(text).toContain("uncertain chronology");
  });

  it("redactWorldFieldsForExport strips archive, planned history, and undated current at point", () => {
    const fields = fieldsFor(stationProfile());
    const policy = writingContextPolicy("drafting");
    const redacted = redactWorldFieldsForExport(fields, policy, {
      point: point("ev_before"),
      edges,
      books: BOOKS,
      viewingProjectId: "book2",
    });
    expect(redacted[WORLD_MARKDOWN_ARCHIVE_KEY]).toBeUndefined();
    const read = readWorldProfile(redacted);
    expect(read.ok).toBe(true);
    const history = read.profile.fieldHistory;
    expect(history.every((c) => c.approval === "approved" && !c.planned)).toBe(true);
    expect(history.some((c) => c.id === "wfh_close")).toBe(false);
    expect(history.some((c) => c.id === "wfh_reopen")).toBe(false);
    expect(history.some((c) => c.id === "wfh_open")).toBe(true);
    expect(read.profile.values.access).toBe("open");
  });
});
