import { describe, expect, it } from "vitest";
import { beatMatchesLinkFilter } from "@/weave/beatLinkFilter";
import {
  WEAVE_BEAT_PRESETS,
  getWeaveBeatPreset,
  layoutWeavePreset,
  readThreadLine,
  withThreadLine,
} from "@/world/weaveBeatPresets";

const EXPECTED: Record<string, { beats: number; threads: number; links: number }> = {
  "three-act": { beats: 8, threads: 3, links: 1 },
  "save-the-cat": { beats: 15, threads: 3, links: 2 },
  "heros-journey": { beats: 12, threads: 3, links: 1 },
  "heroines-journey-murdock": { beats: 10, threads: 4, links: 1 },
  "heroines-journey-carriger": { beats: 10, threads: 3, links: 2 },
  "seven-point": { beats: 7, threads: 3, links: 1 },
  romance: { beats: 7, threads: 3, links: 2 },
  mystery: { beats: 7, threads: 3, links: 2 },
};

describe("weave beat presets", () => {
  it("includes each starter once with separate heroine journeys", () => {
    expect(WEAVE_BEAT_PRESETS.map((preset) => preset.id).sort()).toEqual(Object.keys(EXPECTED).sort());
    for (const preset of WEAVE_BEAT_PRESETS) {
      expect(getWeaveBeatPreset(preset.id)?.title).toBe(preset.title);
    }
    expect(getWeaveBeatPreset("nope")).toBeNull();
    const murdock = getWeaveBeatPreset("heroines-journey-murdock")!;
    const carriger = getWeaveBeatPreset("heroines-journey-carriger")!;
    expect(murdock.title).toContain("Murdock");
    expect(carriger.title).toContain("Carriger");
    expect(murdock.attribution).toContain("Murdock");
    expect(carriger.attribution).toContain("Carriger");
    expect(murdock.sourceUrl).toContain("maureenmurdock.com");
    expect(carriger.sourceUrl).toContain("gailcarriger.com");
    expect(murdock.beats.map((b) => b.key)).not.toEqual(carriger.beats.map((b) => b.key));
    expect(murdock.beats.some((b) => /ordinary world|call to adventure/i.test(b.title))).toBe(false);
    expect(carriger.beats.some((b) => /ordinary world|call to adventure/i.test(b.title))).toBe(false);
  });

  it.each(WEAVE_BEAT_PRESETS.map((preset) => [preset.id, preset] as const))("%s has threads, unique beats, and positions", (id, preset) => {
    const expected = EXPECTED[id]!;
    expect(preset.beats).toHaveLength(expected.beats);
    expect(preset.threads).toHaveLength(expected.threads);
    expect(preset.links).toHaveLength(expected.links);
    expect(new Set(preset.beats.map((beat) => beat.title)).size).toBe(preset.beats.length);
    expect(new Set(preset.threads.map((thread) => thread.key)).size).toBe(preset.threads.length);
    for (const beat of preset.beats) {
      expect(preset.threads.some((thread) => thread.key === beat.threadKey)).toBe(true);
      expect(beat.prompt.trim().length).toBeGreaterThan(0);
    }
    for (const link of preset.links) {
      expect(preset.beats[link.from]).toBeTruthy();
      expect(preset.beats[link.to]).toBeTruthy();
      expect(link.from).not.toBe(link.to);
    }
    const placed = layoutWeavePreset(preset);
    expect(placed).toHaveLength(preset.beats.length);
    const orders = new Map<string, number[]>();
    for (const beat of placed) {
      expect(Number.isFinite(beat.x)).toBe(true);
      expect(Number.isFinite(beat.y)).toBe(true);
      expect(beat.threadTitle.length).toBeGreaterThan(0);
      orders.set(beat.threadKey, [...(orders.get(beat.threadKey) ?? []), beat.cellOrder]);
    }
    for (const list of orders.values()) {
      expect(list).toEqual(list.map((_, index) => index));
    }
  });

  it("stores a thread title on the first line and reads it back", () => {
    const stored = withThreadLine("Act I", "Show the world.");
    expect(readThreadLine(stored)).toEqual({ threadTitle: "Act I", body: "Show the world." });
    expect(readThreadLine("Plain notes")).toEqual({ threadTitle: null, body: "Plain notes" });
  });
});

describe("plot grid link filter", () => {
  const character = { type: "character_dossier", worldKind: null };
  const place = { type: "worldbuilding", worldKind: "place" };
  const faith = { type: "worldbuilding", worldKind: "religion" };

  it("matches characters, places, and point of view", () => {
    const beat = { worldRefs: [character, faith], manuscriptPov: "Mara" };
    expect(beatMatchesLinkFilter(beat, { kind: "all" })).toBe(true);
    expect(beatMatchesLinkFilter(beat, { kind: "character" })).toBe(true);
    expect(beatMatchesLinkFilter(beat, { kind: "location" })).toBe(false);
    expect(beatMatchesLinkFilter({ worldRefs: [place], manuscriptPov: "" }, { kind: "location" })).toBe(true);
    expect(beatMatchesLinkFilter(beat, { kind: "pov", pov: "" })).toBe(true);
    expect(beatMatchesLinkFilter(beat, { kind: "pov", pov: "Mara" })).toBe(true);
    expect(beatMatchesLinkFilter(beat, { kind: "pov", pov: "Jonah" })).toBe(false);
    expect(beatMatchesLinkFilter({ worldRefs: [{ ...character, unavailable: true }], manuscriptPov: "" }, { kind: "character" })).toBe(false);
  });
});
