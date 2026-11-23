import { WEAVE } from "@/ui/labels";

/**
 * Curated starter beat sheets. Adopting one copies into an independently
 * editable structure (or the legacy template / plot-grid paths). The starter
 * itself stays in code and is not a schema. Later starter edits never overwrite
 * an adopted plan. A template beat keeps its column as a first line
 * `Thread: Title`, which apply removes while creating that story thread.
 *
 * Guidance text is short and original — not wholesale copies of published
 * worksheets. Attribution and sourceUrl point authors to the books.
 */

/** Bump when a starter's stages/guidance change in a way authors should track. */
export const WEAVE_PRESET_CATALOG_VERSION = 2;

export interface WeaveBeatPresetThread {
  key: string;
  title: string;
}

export interface WeaveBeatPresetBeat {
  /** Stable within this starter; never used to equate stages across structures. */
  key: string;
  title: string;
  prompt: string;
  threadKey: string;
}

export interface WeaveBeatPresetLink {
  /** Index into `beats`. */
  from: number;
  to: number;
  note: string;
}

export interface WeaveBeatPreset {
  id: string;
  /** Snapshot version copied onto WeaveStructure at adoption. */
  version: number;
  title: string;
  description: string;
  /** Short credit shown on adopted copies (may be empty). */
  attribution: string;
  /** Optional link to the author's page or primary reference (not required). */
  sourceUrl?: string;
  threads: WeaveBeatPresetThread[];
  beats: WeaveBeatPresetBeat[];
  links: WeaveBeatPresetLink[];
}

export interface WeavePresetPlacement {
  title: string;
  prompt: string;
  threadKey: string;
  threadTitle: string;
  x: number;
  y: number;
  cellOrder: number;
}

const COL_W = 280;
const ROW_H = 180;

export function withThreadLine(threadTitle: string, body: string): string {
  const title = threadTitle.trim();
  const notes = body.replace(/^\uFEFF/, "");
  if (!title) return notes;
  return notes.trim() ? `${WEAVE.presetThreadPrefix} ${title}\n\n${notes}` : `${WEAVE.presetThreadPrefix} ${title}`;
}

export function readThreadLine(body: string): { threadTitle: string | null; body: string } {
  const prefix = `${WEAVE.presetThreadPrefix} `;
  if (!body.startsWith(prefix)) return { threadTitle: null, body };
  const breakAt = body.indexOf("\n");
  const threadTitle = (breakAt === -1 ? body.slice(prefix.length) : body.slice(prefix.length, breakAt)).trim();
  if (!threadTitle) return { threadTitle: null, body };
  let rest = breakAt === -1 ? "" : body.slice(breakAt + 1);
  if (rest.startsWith("\n")) rest = rest.slice(1);
  return { threadTitle, body: rest };
}

export function layoutWeavePreset(preset: WeaveBeatPreset): WeavePresetPlacement[] {
  const threadIndex = new Map(preset.threads.map((thread, index) => [thread.key, index]));
  const threadTitle = new Map(preset.threads.map((thread) => [thread.key, thread.title]));
  const seen = new Map<string, number>();
  return preset.beats.map((beat) => {
    const column = threadIndex.get(beat.threadKey) ?? 0;
    const cellOrder = seen.get(beat.threadKey) ?? 0;
    seen.set(beat.threadKey, cellOrder + 1);
    return {
      title: beat.title,
      prompt: beat.prompt,
      threadKey: beat.threadKey,
      threadTitle: threadTitle.get(beat.threadKey) ?? beat.threadKey,
      x: 48 + column * COL_W,
      y: 48 + cellOrder * ROW_H,
      cellOrder,
    };
  });
}

function stage(
  key: string,
  title: string,
  prompt: string,
  threadKey: string,
): WeaveBeatPresetBeat {
  return { key, title, prompt, threadKey };
}

/**
 * Carriger's Heroine's Journey beats are documented across Descent / Search /
 * Ascent in multiple secondary summaries of her book (e.g. DIY MFA, 2021) and
 * her own product page. Stage titles below name the beats; prompts are original
 * short planning cues — not copied book text.
 * Primary: https://gailcarriger.com/books/hj/
 */
export const WEAVE_BEAT_PRESETS: readonly WeaveBeatPreset[] = [
  {
    id: "three-act",
    version: WEAVE_PRESET_CATALOG_VERSION,
    title: WEAVE.presetThreeAct,
    description: "A beginning, a middle, and an end. Eight beats across three acts.",
    attribution: "",
    threads: [
      { key: "act-1", title: "Act I" },
      { key: "act-2", title: "Act II" },
      { key: "act-3", title: "Act III" },
    ],
    beats: [
      stage("opening", "Opening", "Show the world and the person who will be changed, before anything breaks.", "act-1"),
      stage("inciting", "Inciting incident", "The event that makes staying the same impossible.", "act-1"),
      stage("first-turn", "First turning point", "The choice that commits them to the journey.", "act-1"),
      stage("rising", "Rising complications", "Each attempt raises the cost or reveals a new obstacle.", "act-2"),
      stage("midpoint", "Midpoint", "A reveal or reversal that changes what winning would mean.", "act-2"),
      stage("crisis", "Crisis", "The worst credible loss. What they want and what they need collide.", "act-2"),
      stage("climax", "Climax", "They act on what the crisis taught them. The main question is answered.", "act-3"),
      stage("resolution", "Resolution", "Show the new ordinary, and who paid for it.", "act-3"),
    ],
    links: [{ from: 1, to: 6, note: "The inciting incident pays off in the climax." }],
  },
  {
    id: "save-the-cat",
    version: WEAVE_PRESET_CATALOG_VERSION,
    title: WEAVE.presetSaveTheCat,
    description: "Fifteen story beats grouped into three acts. Rename any beat after you adopt it.",
    attribution: "Inspired by Blake Snyder's Save the Cat!",
    sourceUrl: "https://blakesnyder.com/",
    threads: [
      { key: "act-1", title: "Act I" },
      { key: "act-2", title: "Act II" },
      { key: "act-3", title: "Act III" },
    ],
    beats: [
      stage("opening-image", "Opening image", "A snapshot of the life that the ending will contradict.", "act-1"),
      stage("theme-stated", "Theme stated", "Someone names the story's argument. The lead is not ready to hear it.", "act-1"),
      stage("setup", "Setup", "The stakes, the flaw, and the thing they want before the world changes.", "act-1"),
      stage("catalyst", "Catalyst", "The telegram, the body, the knock. Life cannot continue as it was.", "act-1"),
      stage("debate", "Debate", "They hesitate. What do they stand to lose if they go?", "act-1"),
      stage("break-into-two", "Break into two", "They step into the new world on purpose.", "act-2"),
      stage("b-story", "B story", "A relationship that will carry the theme.", "act-2"),
      stage("fun-and-games", "Fun and games", "The promise of the premise: the new world at its most itself.", "act-2"),
      stage("midpoint", "Midpoint", "False victory or false defeat. The stakes become public.", "act-2"),
      stage("bad-guys", "Bad guys close in", "External pressure and internal doubt tighten together.", "act-2"),
      stage("all-is-lost", "All is lost", "The whiff of death: a plan, a bond, or a self-image fails.", "act-2"),
      stage("dark-night", "Dark night of the soul", "They sit with the loss before they can choose differently.", "act-2"),
      stage("break-into-three", "Break into three", "A last idea, usually from the B story, that combines what they learned.", "act-3"),
      stage("finale", "Finale", "They prove the change by solving the story's problem in a new way.", "act-3"),
      stage("final-image", "Final image", "A snapshot that answers the opening image.", "act-3"),
    ],
    links: [
      { from: 0, to: 14, note: "The opening image is answered by the final image." },
      { from: 3, to: 13, note: "The catalyst is resolved in the finale." },
    ],
  },
  {
    id: "heros-journey",
    version: WEAVE_PRESET_CATALOG_VERSION,
    title: WEAVE.presetHerosJourney,
    description: "Twelve stages from the ordinary world, through the ordeal, and home again.",
    attribution: "After Joseph Campbell / Christopher Vogler",
    threads: [
      { key: "departure", title: "Departure" },
      { key: "initiation", title: "Initiation" },
      { key: "return", title: "Return" },
    ],
    beats: [
      stage("ordinary-world", "Ordinary world", "The life they know, including the limitation they cannot see.", "departure"),
      stage("call", "Call to adventure", "A problem or invitation that asks them to leave.", "departure"),
      stage("refusal", "Refusal of the call", "Fear, duty, or doubt holds them back.", "departure"),
      stage("mentor", "Meeting the mentor", "Someone or something gives a tool, a warning, or courage.", "departure"),
      stage("threshold", "Crossing the threshold", "They enter the special world and cannot quietly go back.", "departure"),
      stage("tests", "Tests, allies, and enemies", "The new world sorts who will help, who will hinder, and what the rules are.", "initiation"),
      stage("approach", "Approach to the inmost cave", "They prepare for the central danger.", "initiation"),
      stage("ordeal", "Ordeal", "The greatest fear is faced. Something dies: a plan, an ally, or an old self.", "initiation"),
      stage("reward", "Reward", "They seize what they came for, and learn its price.", "initiation"),
      stage("road-back", "The road back", "Consequences chase them toward home.", "return"),
      stage("resurrection", "Resurrection", "A final test. They must use the change, not only the prize.", "return"),
      stage("elixir", "Return with the elixir", "They bring something home that the ordinary world needed.", "return"),
    ],
    links: [{ from: 1, to: 11, note: "The call is answered by what they bring home." }],
  },
  {
    id: "heroines-journey-murdock",
    version: WEAVE_PRESET_CATALOG_VERSION,
    title: WEAVE.presetHeroinesJourneyMurdock,
    description:
      "Maureen Murdock's ten-stage psycho-spiritual arc. Separate from Campbell's Hero's Journey and from Carriger's model.",
    attribution: "After Maureen Murdock, The Heroine's Journey",
    sourceUrl: "https://maureenmurdock.com/the-heroines-journey/",
    threads: [
      { key: "separation", title: "Separation" },
      { key: "descent", title: "Descent" },
      { key: "initiation", title: "Initiation" },
      { key: "return", title: "Integration" },
    ],
    beats: [
      stage(
        "separation",
        "Separation from the feminine",
        "She leaves or rejects a relational / feminine world or prescribed role.",
        "separation",
      ),
      stage(
        "identification",
        "Identification with the masculine",
        "She adopts the values or strategies of the dominant or heroic path.",
        "separation",
      ),
      stage("road-of-trials", "Road of trials", "She meets resistance while succeeding by those rules.", "descent"),
      stage(
        "illusory-boon",
        "Illusory boon of success",
        "Outer success arrives — and fails to satisfy what she left behind.",
        "descent",
      ),
      stage(
        "strong-women",
        "Spiritual aridity / awakening",
        "Emptiness or loss shows the new way of life is too limited.",
        "descent",
      ),
      stage(
        "initiation-goddess",
        "Initiation and descent to the goddess",
        "Crisis forces a turn inward toward the rejected deep self.",
        "initiation",
      ),
      stage(
        "urgent-yearning",
        "Yearning to reconnect with the feminine",
        "She wants connection she once refused, without returning unchanged.",
        "initiation",
      ),
      stage(
        "healing-mother",
        "Healing the mother / daughter split",
        "She reclaims relational values or lineage from a new vantage.",
        "initiation",
      ),
      stage(
        "healing-wounded",
        "Healing the wounded masculine",
        "She makes peace with strength and agency without abandoning relationship.",
        "return",
      ),
      stage(
        "integration",
        "Integration of masculine and feminine",
        "Both capacities serve a whole person facing a complex world.",
        "return",
      ),
    ],
    links: [{ from: 0, to: 9, note: "Separation is answered by integration." }],
  },
  {
    id: "heroines-journey-carriger",
    version: WEAVE_PRESET_CATALOG_VERSION,
    title: WEAVE.presetHeroinesJourneyCarriger,
    description:
      "Gail Carriger's Descent / Search / Ascent model. Separate from Murdock and from the Hero's Journey — do not blend labels.",
    attribution: "After Gail Carriger, The Heroine's Journey",
    sourceUrl: "https://gailcarriger.com/books/hj/",
    threads: [
      { key: "descent", title: "Descent" },
      { key: "search", title: "Search" },
      { key: "ascent", title: "Ascent" },
    ],
    beats: [
      stage(
        "broken-network",
        "Broken familial network",
        "The starting community is fractured. Name what broke and who feels it.",
        "descent",
      ),
      stage(
        "pleas-ignored",
        "Pleas ignored; abdication of power",
        "Help is refused or useless. She gives up a role, status, or formal power.",
        "descent",
      ),
      stage(
        "involuntary-withdrawal",
        "Involuntary withdrawal",
        "She is pushed out of the old network. Leaving is not a triumphant choice.",
        "descent",
      ),
      stage(
        "aid-no-solution",
        "Aid without a solution",
        "Family or the old circle offers care that does not fix the problem.",
        "descent",
      ),
      stage(
        "isolation-risk",
        "Isolation and risk",
        "Without the network she faces danger, scarcity, or loneliness.",
        "search",
      ),
      stage(
        "disguise",
        "Disguise or altered identity",
        "She changes how she appears or who she claims to be to survive the search.",
        "search",
      ),
      stage(
        "found-family",
        "Found family / surrogate network",
        "She gathers allies who become a chosen community.",
        "search",
      ),
      stage(
        "underworld",
        "Underworld with allies",
        "She enters a dangerous depth or ordeal — not alone if the journey holds.",
        "search",
      ),
      stage(
        "reborn-network",
        "New or reborn network",
        "Success rebuilds or replaces the familial web. Unity matters more than glory.",
        "ascent",
      ),
      stage(
        "negotiation",
        "Negotiation and compromise",
        "A settlement that benefits the group, not only her revenge or status.",
        "ascent",
      ),
    ],
    links: [
      { from: 0, to: 8, note: "The broken network is answered by the reborn network." },
      { from: 6, to: 9, note: "Found family enables the compromise." },
    ],
  },
  {
    id: "seven-point",
    version: WEAVE_PRESET_CATALOG_VERSION,
    title: WEAVE.presetSevenPoint,
    description: "Seven turns. Start from the resolution if you like, then fill backward.",
    attribution: "",
    threads: [
      { key: "opening", title: "Opening" },
      { key: "middle", title: "Middle" },
      { key: "ending", title: "Ending" },
    ],
    beats: [
      stage("hook", "Hook", "The opposite of the resolution. Who are they before the change?", "opening"),
      stage("plot-turn-1", "Plot turn 1", "The event that moves them from the hook into the conflict.", "opening"),
      stage("pinch-1", "Pinch 1", "Pressure applies. The opposing force shows what it can do.", "middle"),
      stage("midpoint", "Midpoint", "They shift from reacting to acting.", "middle"),
      stage("pinch-2", "Pinch 2", "The opposing force strikes harder, often because of the midpoint.", "middle"),
      stage("plot-turn-2", "Plot turn 2", "The last piece they need to make the resolution possible.", "ending"),
      stage("resolution", "Resolution", "The hook's opposite, earned. Show the change in action.", "ending"),
    ],
    links: [{ from: 0, to: 6, note: "The hook and the resolution are opposites." }],
  },
  {
    id: "romance",
    version: WEAVE_PRESET_CATALOG_VERSION,
    title: WEAVE.presetRomance,
    description: "Attraction, the barrier, and the choice to stay. Seven beats.",
    attribution: "",
    threads: [
      { key: "attraction", title: "Attraction" },
      { key: "conflict", title: "Conflict" },
      { key: "commitment", title: "Commitment" },
    ],
    beats: [
      stage("meet", "Meet", "They encounter each other. Note what each thinks the other is.", "attraction"),
      stage("spark", "Spark", "A moment of recognition or desire that neither can quite dismiss.", "attraction"),
      stage("barrier", "Barrier", "The reason they should not, or cannot, be together.", "conflict"),
      stage("deepening", "Deepening", "Proximity reveals a private truth. Trust grows against the barrier.", "conflict"),
      stage("break", "Break", "The barrier wins for a while. One of them leaves, lies, or is left.", "conflict"),
      stage("grand-gesture", "Grand gesture", "A visible choice that costs something and answers the break.", "commitment"),
      stage("commitment", "Commitment", "They choose each other with the truth in view, or they part on purpose.", "commitment"),
    ],
    links: [
      { from: 1, to: 6, note: "The spark pays off in the commitment." },
      { from: 2, to: 5, note: "The barrier is faced in the grand gesture." },
    ],
  },
  {
    id: "mystery",
    version: WEAVE_PRESET_CATALOG_VERSION,
    title: WEAVE.presetMystery,
    description: "A clue trail, a false lead, and a reveal. Seven beats.",
    attribution: "",
    threads: [
      { key: "investigation", title: "Investigation" },
      { key: "misdirection", title: "Misdirection" },
      { key: "solution", title: "Solution" },
    ],
    beats: [
      stage("crime", "Crime discovered", "What is wrong, who notices, and what they do not yet understand.", "investigation"),
      stage("first-clue", "First clue", "A true detail that will still matter at the reveal. Plant it plainly.", "investigation"),
      stage("suspects", "Suspects", "Name who could have done it, and what each is hiding.", "investigation"),
      stage("red-herring", "Red herring", "A convincing false lead. It should be fair, and it should cost someone.", "misdirection"),
      stage("second-clue", "Second clue", "A detail that contradicts the red herring if the reader looks twice.", "misdirection"),
      stage("reversal", "Reversal", "The false lead collapses. The remaining explanation should feel inevitable.", "solution"),
      stage("reveal", "Reveal", "Show how the first clue and the second clue name the truth.", "solution"),
    ],
    links: [
      { from: 1, to: 6, note: "The first clue pays off in the reveal." },
      { from: 3, to: 5, note: "The red herring collapses in the reversal." },
    ],
  },
];

export function getWeaveBeatPreset(id: string): WeaveBeatPreset | null {
  return WEAVE_BEAT_PRESETS.find((preset) => preset.id === id) ?? null;
}
