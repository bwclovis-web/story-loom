import { describe, expect, it } from "vitest";
import {
  adjacentWings,
  applyProfileFillSuggestions,
  applyProfileSuggestions,
  characterProfileMarkdown,
  cuesForManuscript,
  emptyCharacterDevelopment,
  fieldIsEstablishedCanon,
  fieldMetaOf,
  inheritedTraits,
  milestoneFreshness,
  parseProfileSuggestions,
  proposeProfileFillFromBody,
  readCharacterDevelopment,
  renderCharacterContextSlice,
  resolveCharacterState,
  resolveKnowledgeAtPoint,
  seriesMatrix,
  setFieldMeta,
  unsupportedCharacterDevelopmentVersion,
  validateCharacterDevelopment,
  variantWouldCycle,
  visibleProfileSections,
  wingIsValid,
  withCharacterDevelopment,
  type CharacterDevelopment,
  type DevelopmentArc,
  type StateChange,
} from "@/domain/characterDevelopment";

function arc(partial: Partial<DevelopmentArc> & Pick<DevelopmentArc, "id" | "title">): DevelopmentArc {
  return {
    description: "",
    template: "positive_change",
    approval: "approved",
    movement: "progressing",
    scope: "series",
    bookProjectId: null,
    parentArcId: null,
    participantRecordIds: [],
    relationId: null,
    perceptions: [],
    startingState: "",
    desiredOutcome: "",
    startingBelief: "",
    emergingTruth: "",
    internalConflict: "",
    externalConflict: "",
    stakes: "",
    notes: "",
    milestones: [],
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
    sceneRecordId: null,
    sequence: null,
    note: "",
    ...partial,
  };
}

describe("character development", () => {
  it("reads a dossier that has no psychology data", () => {
    const read = readCharacterDevelopment({ name: "Mara", aliases: ["Mara"] });
    expect(read.problems).toEqual([]);
    expect(read.profile).toEqual(emptyCharacterDevelopment());
    const stored = withCharacterDevelopment({ name: "Mara" }, read.profile);
    expect(stored.name).toBe("Mara");
    expect(readCharacterDevelopment({}).profile.psychology.enneagram).toBeNull();
  });

  it("accepts each enneagram type and only a neighboring wing", () => {
    expect(wingIsValid(4, 5)).toBe(true);
    expect(wingIsValid(4, 3)).toBe(true);
    expect(adjacentWings(1)).toEqual([9, 2]);
    expect(adjacentWings(9)).toEqual([8, 1]);
    expect(wingIsValid(4, 8)).toBe(false);
    expect(wingIsValid("unknown", 5)).toBe(false);
    expect(wingIsValid("undecided", null)).toBe(true);
    expect(wingIsValid("not_applicable", null)).toBe(true);
    const bad = readCharacterDevelopment({
      characterDevelopment: { version: 1, psychology: { enneagram: 4, wing: 8 } },
    });
    expect(bad.problems.some((problem) => problem.path.includes("wing"))).toBe(true);
  });

  it("lets a minor character omit the profile and a supporting character keep several series arcs", () => {
    const profile = emptyCharacterDevelopment();
    profile.importance = "minor";
    expect(readCharacterDevelopment(withCharacterDevelopment({}, profile)).problems).toEqual([]);
    profile.importance = "supporting";
    profile.arcs = [
      arc({ id: "arc_series_one", title: "Loyalty", scope: "series" }),
      arc({ id: "arc_series_two", title: "Grief", scope: "series", template: "recovery" }),
    ];
    expect(readCharacterDevelopment(withCharacterDevelopment({}, profile)).problems).toEqual([]);
  });

  it("allows importance to differ by book and nests a book arc under a series arc", () => {
    const profile = emptyCharacterDevelopment();
    profile.bookImportance = [
      { projectId: "book-1", importance: "minor", narrativeRole: "minor", presence: "introduced" },
      { projectId: "book-3", importance: "major", narrativeRole: "supporting", presence: "returning" },
    ];
    profile.arcs = [
      arc({ id: "arc_parent_ok", title: "Across the series", scope: "series" }),
      arc({
        id: "arc_child_ok1",
        title: "Book three turn",
        scope: "book",
        bookProjectId: "book-3",
        parentArcId: "arc_parent_ok",
      }),
    ];
    expect(readCharacterDevelopment(withCharacterDevelopment({}, profile)).problems).toEqual([]);
    const rows = seriesMatrix(
      [{ id: "char-1", title: "Mara", projectId: "book-1", profile }],
      ["book-1", "book-3"],
    );
    expect(rows[0]?.books[0]?.importance).toBe("minor");
    expect(rows[0]?.books[1]?.importance).toBe("major");
    expect(rows[0]?.books[1]?.arcTitles).toEqual(["Across the series", "Book three turn"]);
  });

  it("resolves approved history without planned changes, and does not infer manuscript order", () => {
    const profile = emptyCharacterDevelopment();
    profile.bookStates = [
      {
        projectId: "book-1",
        narrativeIndex: 1,
        openingNote: "",
        closingNote: "",
        opening: [],
        closing: [],
        openingApproval: "approved",
        closingApproval: "approved",
      },
      {
        projectId: "book-3",
        narrativeIndex: 3,
        openingNote: "",
        closingNote: "",
        opening: [],
        closing: [],
        openingApproval: "draft",
        closingApproval: "draft",
      },
    ];
    profile.stateChanges = [
      change({ id: "state_early_1", facet: "belief", text: "The ledger is dry", bookProjectId: "book-1", sequence: 1 }),
      change({ id: "state_plan_001", facet: "belief", text: "The ledger is a lie", planned: true, bookProjectId: "book-3", sequence: 9 }),
      change({ id: "state_late_001", facet: "belief", text: "Salt remembers", bookProjectId: "book-3", storyEventId: "event-later" }),
      change({ id: "state_unk_0001", facet: "knowledge", text: "", presence: "unknown", bookProjectId: "book-1", sequence: 2 }),
    ];
    const early = resolveCharacterState(profile, { bookProjectId: "book-1", storyEventId: null, sequence: 2 });
    expect(early.facets.belief).toEqual({ presence: "set", text: "The ledger is dry", changeId: "state_early_1" });
    expect(early.facets.knowledge.presence).toBe("unknown");
    expect(early.facets.ability.presence).toBe("unset");
    const middle = resolveCharacterState(
      profile,
      { bookProjectId: "book-1", storyEventId: "event-early", sequence: null },
      [{ earlierId: "event-early", laterId: "event-later" }],
    );
    expect(middle.unplacedChangeIds).toContain("state_early_1");
    expect(middle.facets.belief.presence).toBe("unset");
    const later = resolveCharacterState(
      profile,
      { bookProjectId: "book-3", storyEventId: "event-later", sequence: null },
      [{ earlierId: "event-early", laterId: "event-later" }],
    );
    expect(later.facets.belief).toMatchObject({ text: "Salt remembers" });
  });

  it("keeps variant knowledge independent and refuses an inheritance cycle", () => {
    const foundation = emptyCharacterDevelopment();
    foundation.psychology.coreFear = "being forgotten";
    foundation.stateChanges = [change({ id: "state_found_1", facet: "knowledge", text: "The first fire" })];
    const variant = emptyCharacterDevelopment();
    variant.variant = { foundationRecordId: "char-foundation", inheritedKeys: ["coreFear"] };
    variant.stateChanges = [change({ id: "state_var_001", facet: "knowledge", text: "A different fire" })];
    expect(inheritedTraits(variant, foundation)).toEqual([{ key: "coreFear", source: "inherited", value: "being forgotten" }]);
    variant.psychology.coreFear = "being replaced";
    expect(inheritedTraits(variant, foundation)[0]).toEqual({ key: "coreFear", source: "override", value: "being replaced" });
    const variantState = resolveCharacterState(variant, { bookProjectId: "book-1", storyEventId: null, sequence: null });
    expect(variantState.facets.knowledge).toMatchObject({ text: "A different fire" });
    expect(variantWouldCycle([{ recordId: "a", foundationRecordId: "b" }], "b", "a")).toBe(true);
    expect(variantWouldCycle([], "a", "a")).toBe(true);
    expect(variantWouldCycle([], "a", "b")).toBe(false);
  });

  it("stores asymmetric perceptions and flags a stale passage", () => {
    const profile = emptyCharacterDevelopment();
    profile.arcs = [
      arc({
        id: "arc_rel_0001",
        title: "Trust",
        template: "relationship",
        perceptions: [
          { recordId: "mara", feeling: "wary", belief: "He will leave" },
          { recordId: "jon", feeling: "devoted", belief: "She will stay" },
        ],
        milestones: [
          {
            id: "mile_seen_01",
            title: "The quay",
            summary: "",
            status: "manuscript_confirmed",
            bookProjectId: "book-1",
            chapterRecordId: "chapter-1",
            sceneRecordId: null,
            passageExcerpt: "She did not take his hand.",
            passageRevision: 2,
            passageHash: "old",
            storyEventId: null,
            weaveBeatId: null,
            referenceRecordId: null,
            notes: "",
          },
        ],
      }),
    ];
    expect(profile.arcs[0]?.perceptions[0]?.feeling).not.toBe(profile.arcs[0]?.perceptions[1]?.feeling);
    expect(milestoneFreshness(profile.arcs[0]!.milestones[0]!, { revision: 3, hash: "old" })).toBe("stale");
    expect(milestoneFreshness(profile.arcs[0]!.milestones[0]!, { revision: 2, hash: "old" })).toBe("current");
    const cues = cuesForManuscript(
      [{ id: "mara", title: "Mara", projectId: "book-1", profile }],
      "chapter-1",
      { bookProjectId: "book-1", storyEventId: null, sequence: null },
      [],
      "book-1",
    );
    expect(cues.some((cue) => cue.detail.includes("manuscript confirmed"))).toBe(true);
  });

  it("applies extracted suggestions as drafts and ignores an unsupported wing", () => {
    const parsed = parseProfileSuggestions({
      suggestions: [
        { id: "sug_desire_1", kind: "psychology", key: "coreDesire", value: "to keep the record", evidence: "she checked it", confidence: "medium" },
        { id: "sug_type_001", kind: "enneagram", key: "enneagram", value: "1", evidence: "every morning", confidence: "low" },
        { id: "sug_wing_bad", kind: "wing", key: "wing", value: "5", evidence: "no", confidence: "low" },
        { id: "sug_arc_0001", kind: "arc", key: "arc", value: "Learns to trust", evidence: "not yet", confidence: "low" },
      ],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const next = applyProfileSuggestions(emptyCharacterDevelopment(), parsed.suggestions, (prefix) => `${prefix}_made_01`);
    expect(next.psychology.coreDesire).toBe("to keep the record");
    expect(next.psychology.enneagram).toBe(1);
    expect(next.psychology.wing).toBeNull();
    expect(next.arcs[0]?.approval).toBe("draft");
  });

  it("rejects an unsupported development version instead of guessing", () => {
    const read = readCharacterDevelopment({ characterDevelopment: { version: 9 } });
    expect(read.problems[0]?.message).toMatch(/not supported/);
    expect(read.profile).toEqual(emptyCharacterDevelopment());
    expect(unsupportedCharacterDevelopmentVersion({ characterDevelopment: { version: 9 } })).toBe(true);
  });

  it("keeps unknown development keys when saving a known profile", () => {
    const profile = emptyCharacterDevelopment();
    profile.psychology.coreDesire = "to keep the record";
    const stored = withCharacterDevelopment(
      { name: "Mara", characterDevelopment: { version: 1, futureNote: "keep me", psychology: { coreDesire: "old" } } },
      profile,
    );
    const blob = stored.characterDevelopment as Record<string, unknown>;
    expect(blob.futureNote).toBe("keep me");
    expect(stored.name).toBe("Mara");
    expect(readCharacterDevelopment(stored).profile.psychology.coreDesire).toBe("to keep the record");
  });

  it("reads foundation, voice, lived experience, and knowledge without marking an empty profile filled", () => {
    const profile = emptyCharacterDevelopment();
    profile.foundation.appearance = "salt-grey cloak";
    profile.voice.diction = "clipped";
    profile.livedExperience.trauma = "the quay fire";
    profile.livedExperience.aiVisibility = "omit";
    profile.knowledge = [
      {
        id: "know_secret_01",
        kind: "secret",
        statement: "The ledger is forged",
        approval: "approved",
        planned: false,
        bookProjectId: "book-1",
        fromStoryEventId: "event-early",
        untilStoryEventId: null,
        sceneRecordId: null,
        holder: "character",
        aiVisibility: "omit",
        establishedFactId: null,
        provenance: { origin: "author", note: "" },
      },
      {
        id: "know_belief_01",
        kind: "belief",
        statement: "Salt remembers",
        approval: "approved",
        planned: false,
        bookProjectId: "book-1",
        fromStoryEventId: null,
        untilStoryEventId: null,
        sceneRecordId: null,
        holder: "both",
        aiVisibility: "include",
        establishedFactId: null,
        provenance: { origin: "author", note: "" },
      },
    ];
    const roundTrip = readCharacterDevelopment(withCharacterDevelopment({}, profile));
    expect(roundTrip.problems).toEqual([]);
    expect(roundTrip.profile.foundation.appearance).toBe("salt-grey cloak");
    expect(roundTrip.profile.voice.diction).toBe("clipped");
    expect(roundTrip.profile.livedExperience.trauma).toBe("the quay fire");
    const atPoint = resolveKnowledgeAtPoint(
      profile,
      { bookProjectId: "book-1", storyEventId: "event-early", sequence: null },
      [{ earlierId: "event-early", laterId: "event-later" }],
    );
    expect(atPoint.map((item) => item.id)).toEqual(["know_secret_01", "know_belief_01"]);
    const dialogue = renderCharacterContextSlice({
      title: "Mara",
      body: "Archivist.",
      profile,
      slice: "dialogue",
    });
    expect(dialogue).toContain("salt-grey cloak");
    expect(dialogue).not.toContain("the quay fire");
    expect(dialogue).not.toContain("The ledger is forged");
    const continuity = renderCharacterContextSlice({ title: "Mara", profile, slice: "continuity" });
    expect(continuity).toContain("Salt remembers");
    expect(continuity).not.toContain("The ledger is forged");
    const redacted = characterProfileMarkdown("Mara", profile, "redacted");
    expect(redacted).not.toContain("the quay fire");
    expect(redacted).not.toContain("The ledger is forged");
    const full = characterProfileMarkdown("Mara", profile, "full");
    expect(full).toContain("the quay fire");
    expect(full).toContain("The ledger is forged");
  });

  it("lets a variant inherit foundation and voice but not knowledge", () => {
    const foundation = emptyCharacterDevelopment();
    foundation.foundation.publicRole = "Archivist";
    foundation.voice.diction = "clipped";
    foundation.knowledge = [
      {
        id: "know_found_01",
        kind: "knowledge",
        statement: "The first fire",
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
      },
    ];
    const variant = emptyCharacterDevelopment();
    variant.variant = { foundationRecordId: "char-foundation", inheritedKeys: ["foundation", "voice"] };
    expect(inheritedTraits(variant, foundation)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "foundation", source: "inherited" }),
        expect.objectContaining({ key: "voice", source: "inherited" }),
      ]),
    );
    expect(resolveKnowledgeAtPoint(variant, { bookProjectId: "book-1", storyEventId: null, sequence: null })).toEqual([]);
  });

  it("proposes profile fills from matching headings without inventing lived experience", () => {
    const body = "## Appearance\nSalt-grey cloak.\n\n## Voice\nClipped answers.\n\n## Trauma\nDo not copy this.\n";
    const suggestions = proposeProfileFillFromBody(body, emptyCharacterDevelopment());
    expect(suggestions.map((item) => item.key)).toEqual(["appearance", "diction"]);
    const next = applyProfileFillSuggestions(emptyCharacterDevelopment(), suggestions);
    expect(next.foundation.appearance).toBe("Salt-grey cloak.");
    expect(next.voice.diction).toBe("Clipped answers.");
    expect(next.livedExperience.trauma).toBe("");
    expect(next.fieldMeta["foundation.appearance"]?.provenance.origin).toBe("imported");
    expect(next.fieldMeta["foundation.appearance"]?.approval).toBe("draft");
  });

  it("defaults legacy fields without fieldMeta to draft author provenance", () => {
    const profile = emptyCharacterDevelopment();
    profile.foundation.appearance = "Old cloak";
    expect(fieldMetaOf(profile, "foundation.appearance").approval).toBe("draft");
    expect(fieldMetaOf(profile, "foundation.appearance").provenance.origin).toBe("author");
    const approved = setFieldMeta(profile, "foundation.appearance", {
      approval: "approved",
      provenance: { origin: "author", note: "Canon", updatedAt: "2026-01-01T00:00:00.000Z" },
    });
    expect(fieldIsEstablishedCanon(approved, "foundation.appearance")).toBe(true);
    const markdown = characterProfileMarkdown("Mara", approved, "full");
    expect(markdown).toContain("Old cloak");
  });

  it("labels draft and held notes separately from approved canon in context slices", () => {
    let profile = emptyCharacterDevelopment();
    profile.foundation.appearance = "Approved cloak";
    profile.psychology.coreDesire = "Draft desire";
    profile = setFieldMeta(profile, "foundation.appearance", {
      approval: "approved",
      provenance: { origin: "author", note: "", updatedAt: "2026-01-01T00:00:00.000Z" },
    });
    profile = setFieldMeta(profile, "psychology.coreDesire", {
      approval: "proposed",
      provenance: { origin: "extracted", note: "", updatedAt: "2026-01-01T00:00:00.000Z" },
    });
    profile.migrationHold = [
      {
        id: "h1",
        kind: "protected_unknowns",
        fieldPath: "hold.unknowns",
        heading: "Mystery",
        text: "Who forged it?",
        sourceText: "Who forged it?",
        note: "held",
        decision: "retained",
      },
    ];
    const slice = renderCharacterContextSlice({
      title: "Mara",
      body: "## Appearance\nApproved cloak\n\nFreeform quay memory.",
      profile,
      slice: "continuity",
    });
    expect(slice).toMatch(/Established profile/i);
    expect(slice).toContain("Approved cloak");
    expect(slice).toMatch(/not canon/i);
    expect(slice).toContain("Draft desire");
    expect(slice).not.toMatch(/## Established profile[\s\S]*Who forged it/);
  });

  it("keeps Phase 1 identity, behavior, and capabilities through a round trip", () => {
    const profile = emptyCharacterDevelopment();
    profile.foundation.ancestry = "Greyhaven line";
    profile.foundation.culturalIdentity = "Harrowgate clerk";
    profile.voice.humor = "dry";
    profile.voice.consistencyGuardrails = "Never slangy";
    profile.behavior.underPressure = "Goes quiet, then decisive";
    profile.capabilities.skills = "Ledgers and locks";
    profile.capabilities.linkedRecordIds = ["rec_magic_01"];
    profile.livedExperience.formativeExperiences = "The quay fire";
    profile.livedExperience.stereotypesToAvoid = "Helpless trauma survivor";
    const stored = withCharacterDevelopment({ name: "Mara" }, profile);
    const read = readCharacterDevelopment(stored);
    expect(read.problems).toEqual([]);
    expect(read.profile.foundation.ancestry).toBe("Greyhaven line");
    expect(read.profile.behavior.underPressure).toBe("Goes quiet, then decisive");
    expect(read.profile.capabilities.linkedRecordIds).toEqual(["rec_magic_01"]);
    expect(read.profile.livedExperience.stereotypesToAvoid).toBe("Helpless trauma survivor");
    expect(stored.name).toBe("Mara");
  });

  it("suggests thinner sections for minor importance without discarding filled notes", () => {
    const profile = emptyCharacterDevelopment();
    profile.importance = "minor";
    expect(visibleProfileSections(profile)).toEqual(["identity", "continuity"]);
    profile.behavior.habits = "Checks the lock twice";
    profile.importance = "minor";
    expect(visibleProfileSections(profile)).toContain("behavior");
    profile.importance = "major";
    expect(visibleProfileSections(profile)).toContain("psychology");
    expect(profile.behavior.habits).toBe("Checks the lock twice");
  });

  it("loads legacy psychology without new keys and keeps optional psychology fields", () => {
    const stored = {
      characterDevelopment: {
        version: 1,
        psychology: { coreDesire: "truth", coreFear: "erasure" },
        archetypes: [{ id: "arch_legacy", name: "Sage", rank: "primary" }],
      },
    };
    const read = readCharacterDevelopment(stored);
    expect(read.problems).toEqual([]);
    expect(read.profile.psychology.coreDesire).toBe("truth");
    expect(read.profile.psychology.coreMotivation).toBe("");
    expect(read.profile.psychology.blindSpots).toBe("");
    expect(read.profile.psychology.selfPerception).toBe("");
    expect(read.profile.archetypes[0]?.approval).toBe("draft");
    expect(read.profile.archetypes[0]?.evolvesFromId).toBeNull();
    expect(read.profile.archetypes[0]?.rank).toBe("primary");

    const next = emptyCharacterDevelopment();
    next.psychology.coreMotivation = "to keep the record";
    next.psychology.blindSpots = "Cannot see her own need for help";
    next.psychology.emotionalTriggers = "Forged seals";
    next.psychology.behavioralPatterns = "Withdraws into ledgers";
    next.psychology.selfPerception = "Reliable clerk";
    next.psychology.externalPerception = "Cold archivist";
    next.psychology.frameworks = [
      {
        id: "frame_1",
        name: "Author notes",
        notes: "Not a diagnosis",
        approval: "draft",
        provenance: { origin: "author", note: "" },
      },
    ];
    next.archetypes = [
      {
        id: "arch_1",
        name: "Sage",
        custom: false,
        description: "",
        rank: "primary",
        periodLabel: "Books 1-2",
        relationshipRecordId: null,
        evolvesFromId: null,
        evolutionNote: "",
        bookProjectId: null,
        approval: "approved",
        provenance: { origin: "author", note: "" },
      },
      {
        id: "arch_2",
        name: "Shadow",
        custom: false,
        description: "What she denies",
        rank: "shadow",
        periodLabel: "",
        relationshipRecordId: null,
        evolvesFromId: "arch_1",
        evolutionNote: "After the quay fire",
        bookProjectId: "book-1",
        approval: "draft",
        provenance: { origin: "author", note: "" },
      },
      {
        id: "arch_3",
        name: "Saltkeeper",
        custom: true,
        description: "Custom",
        rank: "secondary",
        periodLabel: "",
        relationshipRecordId: null,
        evolvesFromId: null,
        evolutionNote: "",
        bookProjectId: null,
        approval: "proposed",
        provenance: { origin: "imported", note: "" },
      },
    ];
    next.narrativeRole = "mentor";
    const round = readCharacterDevelopment(withCharacterDevelopment({}, next));
    expect(round.problems).toEqual([]);
    expect(round.profile.psychology.coreMotivation).toBe("to keep the record");
    expect(round.profile.archetypes.map((item) => item.rank)).toEqual(["primary", "shadow", "secondary"]);
    expect(round.profile.archetypes[1]?.evolvesFromId).toBe("arch_1");
    expect(round.profile.narrativeRole).toBe("mentor");
  });

  it("rejects cyclic archetype evolution and keeps Extract archetypes draft", () => {
    const profile = emptyCharacterDevelopment();
    profile.archetypes = [
      {
        id: "arch_a",
        name: "Hero",
        custom: false,
        description: "",
        rank: "primary",
        periodLabel: "",
        relationshipRecordId: null,
        evolvesFromId: "arch_b",
        evolutionNote: "",
        bookProjectId: null,
        approval: "draft",
        provenance: { origin: "author", note: "" },
      },
      {
        id: "arch_b",
        name: "Rebel",
        custom: false,
        description: "",
        rank: "secondary",
        periodLabel: "",
        relationshipRecordId: null,
        evolvesFromId: "arch_a",
        evolutionNote: "",
        bookProjectId: null,
        approval: "draft",
        provenance: { origin: "author", note: "" },
      },
    ];
    expect(validateCharacterDevelopment(profile).some((problem) => /circle/i.test(problem.message))).toBe(true);

    const applied = applyProfileSuggestions(
      emptyCharacterDevelopment(),
      [
        {
          id: "sug_1",
          kind: "archetype",
          key: "shadow",
          value: "Trickster",
          evidence: "from the dossier",
          confidence: "medium",
        },
        {
          id: "sug_2",
          kind: "psychology",
          key: "blindSpots",
          value: "Cannot ask for help",
          evidence: "clip",
          confidence: "high",
        },
      ],
      (prefix) => `${prefix}_test`,
    );
    expect(applied.archetypes[0]?.rank).toBe("shadow");
    expect(applied.archetypes[0]?.approval).toBe("draft");
    expect(applied.archetypes[0]?.provenance.origin).toBe("extracted");
    expect(applied.psychology.blindSpots).toBe("Cannot ask for help");
    expect(applied.fieldMeta["psychology.blindSpots"]?.approval).toBe("draft");
    expect(applied.fieldMeta["psychology.blindSpots"]?.provenance.origin).toBe("extracted");
  });

  it("emits approved and draft archetypes separately in context and export", () => {
    const profile = emptyCharacterDevelopment();
    profile.archetypes = [
      {
        id: "arch_1",
        name: "Sage",
        custom: false,
        description: "",
        rank: "primary",
        periodLabel: "",
        relationshipRecordId: null,
        evolvesFromId: null,
        evolutionNote: "Settled",
        bookProjectId: null,
        approval: "approved",
        provenance: { origin: "author", note: "" },
      },
      {
        id: "arch_2",
        name: "Trickster",
        custom: false,
        description: "",
        rank: "shadow",
        periodLabel: "",
        relationshipRecordId: null,
        evolvesFromId: "arch_1",
        evolutionNote: "Denied face",
        bookProjectId: null,
        approval: "draft",
        provenance: { origin: "extracted", note: "" },
      },
    ];
    const slice = renderCharacterContextSlice({ title: "Mara", profile, slice: "dialogue" });
    expect(slice).toMatch(/Established profile — Archetypes/);
    expect(slice).toContain("primary: Sage");
    expect(slice).toMatch(/Draft \/ Proposed notes \(not canon\) — Archetypes/);
    expect(slice).toContain("shadow: Trickster");
    const markdown = characterProfileMarkdown("Mara", profile, "full");
    expect(markdown).toContain("## Archetypes (established)");
    expect(markdown).toContain("## Archetypes (draft / proposed)");
  });
});

void (0 as unknown as CharacterDevelopment);
