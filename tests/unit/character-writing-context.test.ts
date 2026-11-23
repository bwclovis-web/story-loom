import { describe, expect, it } from "vitest";
import {
  emptyBookState,
  emptyCharacterDevelopment,
  setFieldMeta,
  withCharacterDevelopment,
  type CharacterDevelopment,
  type KnowledgeItem,
  type StateChange,
} from "@/domain/characterDevelopment";
import {
  collectCharacterContinuityFindings,
  filterKnowledgeForWriting,
  redactCharacterFieldsForExport,
  summarizeKnowledgeOmissions,
  withSeriesBookOrderFallback,
  writingContextPolicy,
} from "@/domain/characterWritingContext";
import { characterContextFromFields } from "@/server/services/characterWritingContextService";

function approve(profile: CharacterDevelopment, path: string): CharacterDevelopment {
  return setFieldMeta(profile, path, {
    approval: "approved",
    provenance: { origin: "author", note: "", updatedAt: "2026-01-01T00:00:00.000Z" },
  });
}

function knowledge(partial: Partial<KnowledgeItem> & Pick<KnowledgeItem, "id" | "statement">): KnowledgeItem {
  return {
    kind: "knowledge",
    approval: "approved",
    planned: false,
    bookProjectId: "book-1",
    fromStoryEventId: null,
    untilStoryEventId: null,
    sceneRecordId: null,
    holder: "character",
    aiVisibility: "include",
    establishedFactId: null,
    provenance: { origin: "author", note: "" },
    ...partial,
  };
}

function change(partial: Partial<StateChange> & Pick<StateChange, "id" | "facet" | "text">): StateChange {
  return {
    presence: "set",
    approval: "approved",
    planned: false,
    bookProjectId: "book-1",
    storyEventId: null,
    chapterRecordId: null,
    sceneRecordId: null,
    sequence: null,
    note: "",
    supersedesId: null,
    correctionNote: "",
    correctedAt: null,
    ...partial,
  };
}

describe("character writing context policy", () => {
  it("keeps drafting free of reader-only, spoiler, and planned knowledge", () => {
    const drafting = writingContextPolicy("drafting");
    const editorial = writingContextPolicy("editorial");
    const planning = writingContextPolicy("planning", true);
    const items = [
      knowledge({ id: "k1", statement: "Character knows the quay", holder: "character" }),
      knowledge({ id: "k2", statement: "Reader knows the twist", holder: "reader" }),
      knowledge({ id: "k3", statement: "Both know the guild", holder: "both" }),
      knowledge({ id: "k4", statement: "Future reveal", planned: true, holder: "character" }),
      knowledge({ id: "k5", statement: "Spoiler wound", aiVisibility: "spoiler", holder: "character" }),
      knowledge({ id: "k6", statement: "Author only", aiVisibility: "omit", holder: "character" }),
    ];
    expect(filterKnowledgeForWriting(items, drafting).map((item) => item.id)).toEqual(["k1", "k3"]);
    expect(filterKnowledgeForWriting(items, editorial).map((item) => item.id)).toEqual(["k1", "k2", "k3"]);
    expect(filterKnowledgeForWriting(items, planning).map((item) => item.id)).toEqual(["k1", "k2", "k3", "k4", "k5"]);
  });

  it("omits later-book knowledge from an earlier-book drafting slice", () => {
    let profile = emptyCharacterDevelopment();
    profile.foundation.appearance = "salt-grey cloak";
    profile = approve(profile, "foundation.appearance");
    profile.voice.diction = "clipped";
    profile = approve(profile, "voice.diction");
    profile.knowledge = [
      knowledge({
        id: "early",
        statement: "The ledger is in the quay office",
        fromStoryEventId: "event-early",
        holder: "character",
      }),
      knowledge({
        id: "later",
        statement: "The ledger was forged in book two",
        fromStoryEventId: "event-later",
        holder: "character",
      }),
      knowledge({
        id: "reader_only",
        statement: "Narrator tip about the forge",
        holder: "reader",
      }),
      knowledge({
        id: "planned",
        statement: "She will learn the forger's name",
        planned: true,
        holder: "character",
      }),
    ];
    const edges = [{ earlierId: "event-early", laterId: "event-later" }];
    const earlyPoint = { bookProjectId: "book-1", storyEventId: "event-early", sequence: null };
    const drafting = characterContextFromFields({
      title: "Mara",
      body: "Archivist.",
      fieldsJson: JSON.stringify(withCharacterDevelopment({}, profile)),
      projectId: "book-1",
      point: earlyPoint,
      edges,
      mode: "drafting",
    });
    expect(drafting).toContain("salt-grey cloak");
    expect(drafting).toContain("The ledger is in the quay office");
    expect(drafting).not.toContain("The ledger was forged in book two");
    expect(drafting).not.toContain("Narrator tip about the forge");
    expect(drafting).not.toContain("She will learn the forger's name");

    const planning = characterContextFromFields({
      title: "Mara",
      body: "Archivist.",
      fieldsJson: JSON.stringify(withCharacterDevelopment({}, profile)),
      projectId: "book-1",
      point: earlyPoint,
      edges,
      mode: "planning",
      allowFuturePlans: true,
    });
    expect(planning).toContain("She will learn the forger's name");
  });

  it("resolves flashback and injury state at the flashback point, not the later manuscript", () => {
    const profile = emptyCharacterDevelopment();
    profile.stateChanges = [
      change({
        id: "healthy",
        facet: "injury",
        text: "uninjured",
        storyEventId: "event-flashback",
      }),
      change({
        id: "injured",
        facet: "injury",
        text: "broken wrist",
        storyEventId: "event-present",
      }),
    ];
    const edges = [{ earlierId: "event-flashback", laterId: "event-present" }];
    const flashback = characterContextFromFields({
      title: "Mara",
      body: "",
      fieldsJson: JSON.stringify(withCharacterDevelopment({}, profile)),
      projectId: "book-1",
      point: { bookProjectId: "book-1", storyEventId: "event-flashback", sequence: null },
      edges,
      mode: "drafting",
    });
    expect(flashback).toContain("uninjured");
    expect(flashback).not.toContain("broken wrist");

    const present = characterContextFromFields({
      title: "Mara",
      body: "",
      fieldsJson: JSON.stringify(withCharacterDevelopment({}, profile)),
      projectId: "book-1",
      point: { bookProjectId: "book-1", storyEventId: "event-present", sequence: null },
      edges,
      mode: "drafting",
    });
    expect(present).toContain("broken wrist");
  });

  it("keeps incomplete profiles and variant identities usable without dumping every field", () => {
    const incomplete = emptyCharacterDevelopment();
    incomplete.voice.diction = "soft";
    const text = characterContextFromFields({
      title: "New face",
      body: "",
      fieldsJson: JSON.stringify(withCharacterDevelopment({}, incomplete)),
      projectId: "book-1",
      mode: "drafting",
    });
    expect(text).toContain("New face");
    expect(text).toContain("soft");

    const variant = emptyCharacterDevelopment();
    variant.variant = {
      foundationRecordId: "char-foundation",
      inheritedKeys: [],
      relationshipKind: "other",
      relationshipLabel: "dock worker",
    };
    const findings = collectCharacterContinuityFindings({
      characterRecordId: "char-variant",
      characterTitle: "Dock Mara",
      profile: variant,
      point: { bookProjectId: "book-1", storyEventId: null, sequence: null },
    });
    expect(findings.some((item) => item.kind === "character_identity")).toBe(true);
  });

  it("flags unanchored secrets and unplaced limitations without treating growth as an error", () => {
    const profile = emptyCharacterDevelopment();
    profile.knowledge = [
      knowledge({
        id: "secret",
        kind: "secret",
        statement: "She forged the ledger",
        holder: "character",
        fromStoryEventId: null,
        sceneRecordId: null,
      }),
    ];
    profile.stateChanges = [
      change({
        id: "scar",
        facet: "injury",
        text: "scar on left hand",
        // Event with no order edge relative to the focus point → unplaced.
        storyEventId: "event-orphan",
        chapterRecordId: null,
        sceneRecordId: null,
      }),
    ];
    const findings = collectCharacterContinuityFindings({
      characterRecordId: "char-mara",
      characterTitle: "Mara",
      profile,
      point: { bookProjectId: "book-1", storyEventId: "event-early", sequence: null },
      edges: [{ earlierId: "event-early", laterId: "event-later" }],
    });
    expect(findings.some((item) => item.kind === "character_knowledge")).toBe(true);
    expect(findings.some((item) => item.kind === "character_limitation")).toBe(true);
    expect(findings.every((item) => item.severity !== "error")).toBe(true);
  });

  it("summarizes what drafting omitted so editorial reviews can opt into plans", () => {
    const profile = emptyCharacterDevelopment();
    profile.knowledge = [
      knowledge({ id: "open", statement: "Knows the quay", fromStoryEventId: "event-early" }),
      knowledge({
        id: "spoiler",
        statement: "Secret injury",
        fromStoryEventId: "event-early",
        aiVisibility: "spoiler",
      }),
      knowledge({ id: "plan", statement: "Future name", planned: true }),
    ];
    const point = { bookProjectId: "book-1", storyEventId: "event-early", sequence: null };
    const edges = [{ earlierId: "event-early", laterId: "event-later" }];
    const summary = summarizeKnowledgeOmissions(profile, point, edges, writingContextPolicy("drafting"));
    expect(summary.knowledgeCount).toBe(1);
    expect(summary.omittedSpoilers).toBe(1);
    expect(summary.omittedPlanned).toBe(1);
  });

  it("does not emit false-positive character_limitation for anchored state changes on project-wide ledger", () => {
    const profile = emptyCharacterDevelopment();
    profile.stateChanges = [
      change({
        id: "anchored-by-event",
        facet: "injury",
        text: "burnt palm",
        bookProjectId: "book-1",
        storyEventId: "event-1",
      }),
      change({
        id: "truly-unanchored",
        facet: "ability",
        text: "speaks Old Salt",
        bookProjectId: "book-2",
        storyEventId: null,
        chapterRecordId: null,
        sceneRecordId: null,
        sequence: null,
      }),
    ];
    const findings = collectCharacterContinuityFindings({
      characterRecordId: "char-mara",
      characterTitle: "Mara",
      profile,
      point: { bookProjectId: "book-1", storyEventId: null, sequence: null },
      edges: [],
    });
    const limitations = findings.filter((item) => item.kind === "character_limitation");
    expect(limitations).toHaveLength(1);
    expect(limitations[0]?.evidence).toContain("speaks Old Salt");
  });

  it("fills fallback book order indices and redacts spoilers from exported fields", () => {
    const profile = emptyCharacterDevelopment();
    profile.livedExperience.formativeExperiences = "Private author backstory";
    profile.bookStates = [
      { ...emptyBookState("book-1"), openingNote: "Opening", openingApproval: "approved" },
      { ...emptyBookState("book-3"), openingNote: "Book 3 opening" },
    ];
    profile.knowledge = [
      knowledge({ id: "open", statement: "Knows the harbour", fromStoryEventId: "ev-1", holder: "character" }),
      knowledge({ id: "later", statement: "Book 4 twist", fromStoryEventId: "ev-4", holder: "character" }),
      knowledge({ id: "omit", statement: "Author-only note", aiVisibility: "omit", holder: "character" }),
      knowledge({ id: "spoiler", statement: "Spoiler reveal", aiVisibility: "spoiler", holder: "character" }),
      knowledge({ id: "plan", statement: "Planned betrayal", planned: true, holder: "character" }),
    ];
    const ordered = withSeriesBookOrderFallback(profile, ["book-1", "book-2", "book-3"]);
    expect(ordered.bookStates.map((b) => [b.projectId, b.narrativeIndex])).toEqual([
      ["book-1", 0],
      ["book-2", 1],
      ["book-3", 2],
    ]);

    const manual = emptyCharacterDevelopment();
    manual.bookStates = [{ ...emptyBookState("book-3"), narrativeIndex: 9 }];
    expect(withSeriesBookOrderFallback(manual, ["book-1", "book-2", "book-3"]).bookStates[0]?.narrativeIndex).toBe(9);

    const rawFields = {
      ...withCharacterDevelopment({}, profile),
      dossierMarkdownArchive: { version: 1, markdown: "# Secret archive" },
    };
    const redacted = redactCharacterFieldsForExport(rawFields, writingContextPolicy("drafting"), {
      point: { bookProjectId: "book-1", storyEventId: "ev-1", sequence: null },
      edges: [{ earlierId: "ev-1", laterId: "ev-4" }],
    });
    expect("dossierMarkdownArchive" in redacted).toBe(false);
    const parsed = characterContextFromFields({
      title: "Mara",
      body: "",
      fieldsJson: JSON.stringify(redacted),
      projectId: "book-1",
      point: { bookProjectId: "book-1", storyEventId: "ev-1", sequence: null },
      edges: [{ earlierId: "ev-1", laterId: "ev-4" }],
      mode: "drafting",
    });
    expect(parsed).toContain("Knows the harbour");
    expect(parsed).not.toContain("Private author backstory");
    expect(parsed).not.toContain("Book 4 twist");
    expect(parsed).not.toContain("Author-only note");
    expect(parsed).not.toContain("Spoiler reveal");
    expect(parsed).not.toContain("Planned betrayal");
  });
});
