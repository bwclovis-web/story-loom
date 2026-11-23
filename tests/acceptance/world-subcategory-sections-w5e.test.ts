import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { JsonObject } from "@/domain/json";
import {
  emptyWorldProfile,
  readWorldProfile,
  WORLD_PROFILE_KEY,
  type WorldFieldHistoryChange,
  type WorldProfile,
} from "@/domain/worldProfile";
import { resolveWorldFieldsAtPoint } from "@/domain/worldProfileHistory";
import { renderWorldContextSlice } from "@/domain/worldWritingContext";
import { createWorkspaceBackup, restoreWorkspaceBackup } from "@/server/services/backupService";
import { createProject, createWorkspace } from "@/server/services/projectService";
import { createRecord, getRecord, updateRecord } from "@/server/services/recordService";
import { createStoryEvent, linkStoryEventScene, orderStoryEvents } from "@/server/services/storyEventService";
import { saveWorldProfileOverlay } from "@/server/services/worldProfileUpgradeService";
import { buildReferencesMarkdownBundle } from "@/server/services/worldBibleExport";
import { buildWorldBibleExportModel } from "@/server/services/worldBibleModel";
import { renderWorldBibleProfileMarkdown } from "@/server/services/worldBibleProfileRender";
import { evaluatePassageAgainstWorldFact, findingsToPersist } from "@/domain/worldContradiction";
import { withRecordTaxonomy } from "@/world/taxonomy";
import { createTestDb, type TestDb } from "../helpers";

const WSP = "wsp_w5e";
const BOOK = "prj_w5e_book";
const GUILD = "rec_w5e_guild";
const RITE = "rec_w5e_rite";
const PARENT = "rec_w5e_parent";
const DIALECT = "rec_w5e_dialect";
const CHAPTER = "rec_w5e_chapter";
const SCENE_EARLY = "rec_w5e_scene_early";
const SCENE_LATER = "rec_w5e_scene_later";

const PUBLIC_STEPS = [
  "Wash the body with river water",
  "Light the blue lantern",
  "Speak the dead person's harbor name",
];
const LATER_STEPS = [
  "Wash the body with river water",
  "Light the blue lantern",
  "Speak the secret harbor name",
];
const EXAMPLE_LINES = [
  { line: "Kael tor ven", gloss: "the tide turns" },
  { line: "Vael mir sen", gloss: "the lamp is low" },
];

function historyChange(
  partial: Partial<WorldFieldHistoryChange> & Pick<WorldFieldHistoryChange, "id" | "fieldPath" | "value">,
): WorldFieldHistoryChange {
  return {
    definitionId: "category:religion",
    storage: "profile",
    presence: "set",
    approval: "approved",
    planned: false,
    provenance: { origin: "author", note: "" },
    bookProjectId: BOOK,
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

describe("W5D guild, ritual, and dialect sections", () => {
  let t: TestDb;

  beforeEach(async () => {
    t = await createTestDb();
    await createWorkspace(t.db, { id: WSP, name: "W5E Workspace" });
    await createProject(t.db, { id: BOOK, workspaceId: WSP, title: "W5E Book" });
  }, 15_000);

  afterEach(async () => {
    await t.cleanup();
  });

  it("saves membership apart from admission, ordered rite steps, and glossed examples", async () => {
    await createRecord(t.db, BOOK, {
      recordId: GUILD,
      type: "worldbuilding",
      title: "Greywharf Coopers",
      body: "A cooper's guild.",
      fields: withRecordTaxonomy(
        { kind: "organization" },
        { version: 1, primary: { category: "organizations", subcategory: "guilds" } },
      ),
      authorityStatus: "approved",
    });
    await createRecord(t.db, BOOK, {
      recordId: RITE,
      type: "worldbuilding",
      title: "Lantern Vigil",
      body: "A funeral rite.",
      fields: withRecordTaxonomy(
        { kind: "religion" },
        { version: 1, primary: { category: "religion", subcategory: "rituals" } },
      ),
      authorityStatus: "approved",
    });
    await createRecord(t.db, BOOK, {
      recordId: PARENT,
      type: "worldbuilding",
      title: "High Harbour Speech",
      body: "The parent language.",
      fields: withRecordTaxonomy(
        { kind: "language" },
        { version: 1, primary: { category: "languages", subcategory: "languages" } },
      ),
      authorityStatus: "approved",
    });
    await createRecord(t.db, BOOK, {
      recordId: DIALECT,
      type: "worldbuilding",
      title: "Harbour Cant",
      body: "A dockside dialect.",
      fields: withRecordTaxonomy(
        { kind: "language" },
        { version: 1, primary: { category: "languages", subcategory: "dialects" } },
      ),
      authorityStatus: "approved",
    });

    const guildProfile: WorldProfile = {
      ...emptyWorldProfile(),
      definitionId: "category:organizations",
      enabledSections: ["organizations:guilds"],
      values: {
        membership: "Journeymen and masters of the Greywharf coopers.",
        admissionRequirements: "A living sponsor and one finished cask that holds water overnight.",
        apprenticeshipStages: ["Sweep the yard", "Raise a cask", "Seal a seam"],
        credentialsIssued: ["Yard token", "Cooper's mark"],
      },
    };
    const riteProfile: WorldProfile = {
      ...emptyWorldProfile(),
      definitionId: "category:religion",
      enabledSections: ["religion:rituals"],
      values: {
        ritualOccasion: "The night a harbor death is known",
        participantRoles: ["Lantern bearer", "Name speaker", "Kin"],
        ritualSteps: PUBLIC_STEPS,
        ritualVariations: "Inland chapels use well water instead of the river.",
      },
    };
    const dialectProfile: WorldProfile = {
      ...emptyWorldProfile(),
      definitionId: "category:languages",
      enabledSections: ["languages:dialects"],
      values: {
        parentLanguage: { recordId: PARENT },
        regionalSoundChanges: "Harbour Cant drops the final r and raises the vowel in tide.",
        distinctiveExpressions: ["tide-true", "lamp-low"],
        exampleLines: EXAMPLE_LINES,
      },
    };

    await saveWorldProfileOverlay(t.db, {
      projectId: BOOK,
      recordId: GUILD,
      expectedRevision: 1,
      profile: guildProfile,
    });
    await saveWorldProfileOverlay(t.db, {
      projectId: BOOK,
      recordId: RITE,
      expectedRevision: 1,
      profile: riteProfile,
    });
    await saveWorldProfileOverlay(t.db, {
      projectId: BOOK,
      recordId: DIALECT,
      expectedRevision: 1,
      profile: dialectProfile,
    });

    const guild = readWorldProfile((await getRecord(t.db, BOOK, GUILD)).fields);
    expect(guild.profile.values.membership).toBe("Journeymen and masters of the Greywharf coopers.");
    expect(guild.profile.values.admissionRequirements).toBe(
      "A living sponsor and one finished cask that holds water overnight.",
    );
    expect(guild.profile.values.admissionRequirements).not.toBe(guild.profile.values.membership);
    expect(guild.profile.values.apprenticeshipStages).toEqual(["Sweep the yard", "Raise a cask", "Seal a seam"]);

    const rite = readWorldProfile((await getRecord(t.db, BOOK, RITE)).fields);
    expect(rite.profile.values.ritualSteps).toEqual(PUBLIC_STEPS);

    const dialect = readWorldProfile((await getRecord(t.db, BOOK, DIALECT)).fields);
    expect(dialect.profile.values.exampleLines).toEqual(EXAMPLE_LINES);
    expect(dialect.profile.values.parentLanguage).toEqual({ recordId: PARENT });

    const hiddenGuild: WorldProfile = { ...guild.profile, enabledSections: [] };
    const guildRecord = await getRecord(t.db, BOOK, GUILD);
    await saveWorldProfileOverlay(t.db, {
      projectId: BOOK,
      recordId: GUILD,
      expectedRevision: guildRecord.currentRevision,
      profile: hiddenGuild,
    });
    const hidden = readWorldProfile((await getRecord(t.db, BOOK, GUILD)).fields);
    expect(hidden.profile.enabledSections).toEqual([]);
    expect(hidden.profile.values.admissionRequirements).toBe(guild.profile.values.admissionRequirements);
    expect(hidden.profile.values.membership).toBe(guild.profile.values.membership);
    expect(hidden.profile.definitionId).toBe("category:organizations");

    const shownAgain: WorldProfile = {
      ...hidden.profile,
      enabledSections: ["organizations:guilds"],
    };
    const hiddenRecord = await getRecord(t.db, BOOK, GUILD);
    await saveWorldProfileOverlay(t.db, {
      projectId: BOOK,
      recordId: GUILD,
      expectedRevision: hiddenRecord.currentRevision,
      profile: shownAgain,
    });
    const reenabled = readWorldProfile((await getRecord(t.db, BOOK, GUILD)).fields);
    expect(reenabled.profile.enabledSections).toEqual(["organizations:guilds"]);
    expect(reenabled.profile.values.apprenticeshipStages).toEqual(["Sweep the yard", "Raise a cask", "Seal a seam"]);

    const beforeTaxonomy = await getRecord(t.db, BOOK, GUILD);
    await updateRecord(t.db, BOOK, {
      recordId: GUILD,
      expectedRevision: beforeTaxonomy.currentRevision,
      fields: withRecordTaxonomy(beforeTaxonomy.fields as JsonObject, {
        version: 1,
        primary: { category: "organizations", subcategory: "guilds" },
        secondary: [{ category: "religion", subcategory: "rituals" }],
      }),
    });
    const afterTaxonomy = readWorldProfile((await getRecord(t.db, BOOK, GUILD)).fields);
    expect(afterTaxonomy.profile.definitionId).toBe("category:organizations");
    expect(afterTaxonomy.profile.enabledSections).toEqual(["organizations:guilds"]);
    expect(afterTaxonomy.profile.values.credentialsIssued).toEqual(["Yard token", "Cooper's mark"]);

    const model = await buildWorldBibleExportModel(t.db, BOOK, {
      recordIds: [GUILD, RITE, DIALECT, PARENT],
    });
    const guildEntry = model.entries.find((entry) => entry.record.id === GUILD);
    const riteEntry = model.entries.find((entry) => entry.record.id === RITE);
    const dialectEntry = model.entries.find((entry) => entry.record.id === DIALECT);
    expect(guildEntry?.fields.find((field) => field.key === "membership")?.value).toBe(
      "Journeymen and masters of the Greywharf coopers.",
    );
    expect(guildEntry?.fields.find((field) => field.key === "admissionRequirements")?.value).toContain("finished cask");
    const steps = riteEntry?.fields.find((field) => field.key === "ritualSteps")?.value ?? "";
    expect(steps.indexOf(PUBLIC_STEPS[0]!)).toBeGreaterThanOrEqual(0);
    expect(steps.indexOf(PUBLIC_STEPS[0]!)).toBeLessThan(steps.indexOf(PUBLIC_STEPS[1]!));
    expect(steps.indexOf(PUBLIC_STEPS[1]!)).toBeLessThan(steps.indexOf(PUBLIC_STEPS[2]!));
    const examples = dialectEntry?.fields.find((field) => field.key === "exampleLines")?.value ?? "";
    expect(examples).toContain("Kael tor ven — the tide turns");
    expect(examples).toContain("Vael mir sen — the lamp is low");
    expect(examples.indexOf("Kael tor ven")).toBeLessThan(examples.indexOf("Vael mir sen"));
    expect(dialectEntry?.fields.find((field) => field.key === "parentLanguage")).toMatchObject({
      value: "High Harbour Speech",
      hrefRecordId: PARENT,
    });

    const markdown = renderWorldBibleProfileMarkdown(dialectEntry!, model);
    expect(markdown).toContain("Kael tor ven — the tide turns");
    expect(markdown).toContain("Vael mir sen — the lamp is low");
    expect(markdown).toContain("High Harbour Speech");

    const bundle = await buildReferencesMarkdownBundle(t.db, BOOK, { recordIds: [GUILD, RITE, DIALECT, PARENT] });
    const zip = await JSZip.loadAsync(bundle.bytes);
    const riteMd = await zip.file(`${riteEntry!.pageId}.md`)!.async("string");
    expect(riteMd.indexOf(PUBLIC_STEPS[0]!)).toBeLessThan(riteMd.indexOf(PUBLIC_STEPS[2]!));
    const dialectMd = await zip.file(`${dialectEntry!.pageId}.md`)!.async("string");
    expect(dialectMd).toContain("Kael tor ven — the tide turns");
    expect(dialectMd).toContain("[High Harbour Speech]");

    const backup = await createWorkspaceBackup(t.db, WSP);
    const target = await createTestDb();
    try {
      const outcome = await restoreWorkspaceBackup(target.db, backup, { idStrategy: "preserve" });
      expect(outcome.ok).toBe(true);
      const restored = readWorldProfile((await getRecord(target.db, BOOK, DIALECT)).fields);
      expect(restored.profile.values.exampleLines).toEqual(EXAMPLE_LINES);
      expect(restored.profile.values.parentLanguage).toEqual({ recordId: PARENT });
      expect(restored.profile.enabledSections).toEqual(["languages:dialects"]);
    } finally {
      await target.cleanup();
    }
  });

  it("keeps an older profile without enabledSections readable", async () => {
    await createRecord(t.db, BOOK, {
      recordId: GUILD,
      type: "worldbuilding",
      title: "Old Cooper Note",
      body: "Written before optional sections.",
      fields: {
        kind: "organization",
        [WORLD_PROFILE_KEY]: {
          version: 1,
          definitionId: "category:organizations",
          summary: "A guild note with no section list.",
          values: { membership: "Journeymen only." },
          collections: {},
          fieldMeta: {},
          migrationHold: [],
          fieldHistory: [],
        },
      },
      authorityStatus: "draft",
    });
    const stored = await getRecord(t.db, BOOK, GUILD);
    const raw = stored.fields[WORLD_PROFILE_KEY] as { enabledSections?: unknown };
    expect(raw.enabledSections).toBeUndefined();
    const read = readWorldProfile(stored.fields);
    expect(read.ok).toBe(true);
    expect(read.profile.enabledSections).toEqual([]);
    expect(read.profile.values.membership).toBe("Journeymen only.");
    expect(read.profile.definitionId).toBe("category:organizations");
  });

  it("keeps a later rite change unknown at an earlier scene", async () => {
    const early = await createStoryEvent(t.db, BOOK, { title: "First bell" });
    const later = await createStoryEvent(t.db, BOOK, { title: "Secret naming" });
    await orderStoryEvents(t.db, BOOK, {
      eventId: early.id,
      otherEventId: later.id,
      direction: "before",
      expectedRevision: 0,
    });
    await createRecord(t.db, BOOK, {
      recordId: CHAPTER,
      type: "manuscript_chapter",
      title: "Harbor funerals",
      body: "Chapter shell.",
      authorityStatus: "draft",
    });
    await createRecord(t.db, BOOK, {
      recordId: SCENE_EARLY,
      type: "manuscript_scene",
      title: "Before the vigil",
      body: "The body is still on the dock.",
      authorityStatus: "draft",
      parentRecordId: CHAPTER,
    });
    await createRecord(t.db, BOOK, {
      recordId: SCENE_LATER,
      type: "manuscript_scene",
      title: "After the vigil",
      body: "The lantern is out.",
      authorityStatus: "draft",
      parentRecordId: CHAPTER,
    });
    const earlyRow = await t.db.storyEvent.findFirstOrThrow({ where: { id: early.id } });
    const laterRow = await t.db.storyEvent.findFirstOrThrow({ where: { id: later.id } });
    await linkStoryEventScene(t.db, BOOK, early.id, SCENE_EARLY, earlyRow.revision);
    await linkStoryEventScene(t.db, BOOK, later.id, SCENE_LATER, laterRow.revision);

    await createRecord(t.db, BOOK, {
      recordId: RITE,
      type: "worldbuilding",
      title: "Lantern Vigil",
      body: "A funeral rite.",
      fields: withRecordTaxonomy(
        { kind: "religion" },
        { version: 1, primary: { category: "religion", subcategory: "rituals" } },
      ),
      authorityStatus: "approved",
    });
    const profile: WorldProfile = {
      ...emptyWorldProfile(),
      definitionId: "category:religion",
      enabledSections: ["religion:rituals"],
      values: { ritualSteps: PUBLIC_STEPS },
      fieldHistory: [
        historyChange({
          id: "wfh_w5e_steps",
          fieldPath: "values.ritualSteps",
          value: LATER_STEPS,
          storyEventId: later.id,
        }),
      ],
    };
    await saveWorldProfileOverlay(t.db, {
      projectId: BOOK,
      recordId: RITE,
      expectedRevision: 1,
      profile,
    });

    const earlyExport = await buildWorldBibleExportModel(
      t.db,
      BOOK,
      { recordIds: [RITE] },
      { mode: "point", storyPointRecordId: SCENE_EARLY, bookProjectId: BOOK, approvedOnly: true },
    );
    const earlyText = earlyExport.entries
      .flatMap((entry) => entry.fields.map((field) => field.value))
      .join("\n");
    expect(earlyText).not.toMatch(/blue lantern/i);
    expect(earlyText).not.toMatch(/secret harbor name/i);

    const laterExport = await buildWorldBibleExportModel(
      t.db,
      BOOK,
      { recordIds: [RITE] },
      { mode: "point", storyPointRecordId: SCENE_LATER, bookProjectId: BOOK, approvedOnly: true },
    );
    const laterSteps = laterExport.entries[0]?.fields.find((field) => field.key === "ritualSteps")?.value ?? "";
    expect(laterSteps.indexOf("Wash the body with river water")).toBeLessThan(laterSteps.indexOf("Light the blue lantern"));
    expect(laterSteps.indexOf("Light the blue lantern")).toBeLessThan(laterSteps.indexOf("Speak the secret harbor name"));

    const saved = readWorldProfile((await getRecord(t.db, BOOK, RITE)).fields).profile;
    const orderEdges = [{ earlierId: early.id, laterId: later.id }];
    const earlyPoint = {
      bookProjectId: BOOK,
      storyEventId: early.id,
      chapterRecordId: CHAPTER,
      sceneRecordId: SCENE_EARLY,
      sequence: null,
      boundary: "at_point" as const,
    };
    const laterPoint = { ...earlyPoint, storyEventId: later.id, sceneRecordId: SCENE_LATER };
    expect(resolveWorldFieldsAtPoint(saved, earlyPoint, orderEdges, { fieldPaths: ["values.ritualSteps"] }).fields[
      "values.ritualSteps"
    ]?.presence).toBe("unknown");
    const laterResolved = resolveWorldFieldsAtPoint(saved, laterPoint, orderEdges, {
      fieldPaths: ["values.ritualSteps"],
    });
    expect(laterResolved.fields["values.ritualSteps"]).toMatchObject({ presence: "set" });
    expect(laterResolved.fields["values.ritualSteps"]?.presence === "set"
      ? laterResolved.fields["values.ritualSteps"].formatted
      : "").toContain("Speak the secret harbor name");

    const drafting = renderWorldContextSlice({
      title: "Lantern Vigil",
      recordId: RITE,
      fields: (await getRecord(t.db, BOOK, RITE)).fields,
      mode: "drafting",
      point: earlyPoint,
      edges: orderEdges,
      viewingProjectId: BOOK,
    });
    expect(drafting.text).not.toMatch(/blue lantern|secret harbor name/i);

    const sample = evaluatePassageAgainstWorldFact({
      passage: {
        text: "Lantern Vigil buried the dead without a lantern.",
        start: 0,
        end: 48,
        stance: "narration",
      },
      fact: {
        worldRecordId: RITE,
        worldTitle: "Lantern Vigil",
        fieldPath: "values.ritualSteps",
        changeId: "wfh_w5e_steps",
        worldRecordRevision: 2,
        value: LATER_STEPS,
        formatted: LATER_STEPS.join(", "),
        storyPointLabel: "Secret naming",
        subcategoryId: "rituals",
      },
      manuscriptRecordId: SCENE_LATER,
      manuscriptRevision: 1,
    });
    expect(sample.verdict).toBe("insufficient_evidence");
    expect(findingsToPersist([sample])).toEqual([]);
  });
});
