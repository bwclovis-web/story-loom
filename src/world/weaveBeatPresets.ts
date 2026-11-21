import { WEAVE } from "@/ui/labels";

/**
 * Curated starter beat sheets. Adopting one copies it into editable template
 * rows or a new grid. The starter itself stays in code and is not a schema.
 * A template beat keeps its column as a first line `Thread: Title`, which
 * apply removes while creating that story thread.
 */

export interface WeaveBeatPresetThread {
  key: string;
  title: string;
}

export interface WeaveBeatPresetBeat {
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
  title: string;
  description: string;
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

export const WEAVE_BEAT_PRESETS: readonly WeaveBeatPreset[] = [
  {
    id: "three-act",
    title: WEAVE.presetThreeAct,
    description: "A beginning, a middle, and an end. Eight beats across three acts.",
    threads: [
      { key: "act-1", title: "Act I" },
      { key: "act-2", title: "Act II" },
      { key: "act-3", title: "Act III" },
    ],
    beats: [
      { title: "Opening", prompt: "Show the world and the person who will be changed, before anything breaks.", threadKey: "act-1" },
      { title: "Inciting incident", prompt: "The event that makes staying the same impossible.", threadKey: "act-1" },
      { title: "First turning point", prompt: "The choice that commits them to the journey.", threadKey: "act-1" },
      { title: "Rising complications", prompt: "Each attempt raises the cost or reveals a new obstacle.", threadKey: "act-2" },
      { title: "Midpoint", prompt: "A reveal or reversal that changes what winning would mean.", threadKey: "act-2" },
      { title: "Crisis", prompt: "The worst credible loss. What they want and what they need collide.", threadKey: "act-2" },
      { title: "Climax", prompt: "They act on what the crisis taught them. The main question is answered.", threadKey: "act-3" },
      { title: "Resolution", prompt: "Show the new ordinary, and who paid for it.", threadKey: "act-3" },
    ],
    links: [
      { from: 1, to: 6, note: "The inciting incident pays off in the climax." },
    ],
  },
  {
    id: "save-the-cat",
    title: WEAVE.presetSaveTheCat,
    description: "Fifteen story beats grouped into three acts. Rename any beat after you adopt it.",
    threads: [
      { key: "act-1", title: "Act I" },
      { key: "act-2", title: "Act II" },
      { key: "act-3", title: "Act III" },
    ],
    beats: [
      { title: "Opening image", prompt: "A snapshot of the life that the ending will contradict.", threadKey: "act-1" },
      { title: "Theme stated", prompt: "Someone names the story's argument. The lead is not ready to hear it.", threadKey: "act-1" },
      { title: "Setup", prompt: "The stakes, the flaw, and the thing they want before the world changes.", threadKey: "act-1" },
      { title: "Catalyst", prompt: "The telegram, the body, the knock. Life cannot continue as it was.", threadKey: "act-1" },
      { title: "Debate", prompt: "They hesitate. What do they stand to lose if they go?", threadKey: "act-1" },
      { title: "Break into two", prompt: "They step into the new world on purpose.", threadKey: "act-2" },
      { title: "B story", prompt: "A relationship that will carry the theme.", threadKey: "act-2" },
      { title: "Fun and games", prompt: "The promise of the premise: the new world at its most itself.", threadKey: "act-2" },
      { title: "Midpoint", prompt: "False victory or false defeat. The stakes become public.", threadKey: "act-2" },
      { title: "Bad guys close in", prompt: "External pressure and internal doubt tighten together.", threadKey: "act-2" },
      { title: "All is lost", prompt: "The whiff of death: a plan, a bond, or a self-image fails.", threadKey: "act-2" },
      { title: "Dark night of the soul", prompt: "They sit with the loss before they can choose differently.", threadKey: "act-2" },
      { title: "Break into three", prompt: "A last idea, usually from the B story, that combines what they learned.", threadKey: "act-3" },
      { title: "Finale", prompt: "They prove the change by solving the story's problem in a new way.", threadKey: "act-3" },
      { title: "Final image", prompt: "A snapshot that answers the opening image.", threadKey: "act-3" },
    ],
    links: [
      { from: 0, to: 14, note: "The opening image is answered by the final image." },
      { from: 3, to: 13, note: "The catalyst is resolved in the finale." },
    ],
  },
  {
    id: "heros-journey",
    title: WEAVE.presetHerosJourney,
    description: "Twelve stages from the ordinary world, through the ordeal, and home again.",
    threads: [
      { key: "departure", title: "Departure" },
      { key: "initiation", title: "Initiation" },
      { key: "return", title: "Return" },
    ],
    beats: [
      { title: "Ordinary world", prompt: "The life they know, including the limitation they cannot see.", threadKey: "departure" },
      { title: "Call to adventure", prompt: "A problem or invitation that asks them to leave.", threadKey: "departure" },
      { title: "Refusal of the call", prompt: "Fear, duty, or doubt holds them back.", threadKey: "departure" },
      { title: "Meeting the mentor", prompt: "Someone or something gives a tool, a warning, or courage.", threadKey: "departure" },
      { title: "Crossing the threshold", prompt: "They enter the special world and cannot quietly go back.", threadKey: "departure" },
      { title: "Tests, allies, and enemies", prompt: "The new world sorts who will help, who will hinder, and what the rules are.", threadKey: "initiation" },
      { title: "Approach to the inmost cave", prompt: "They prepare for the central danger.", threadKey: "initiation" },
      { title: "Ordeal", prompt: "The greatest fear is faced. Something dies: a plan, an ally, or an old self.", threadKey: "initiation" },
      { title: "Reward", prompt: "They seize what they came for, and learn its price.", threadKey: "initiation" },
      { title: "The road back", prompt: "Consequences chase them toward home.", threadKey: "return" },
      { title: "Resurrection", prompt: "A final test. They must use the change, not only the prize.", threadKey: "return" },
      { title: "Return with the elixir", prompt: "They bring something home that the ordinary world needed.", threadKey: "return" },
    ],
    links: [
      { from: 1, to: 11, note: "The call is answered by what they bring home." },
    ],
  },
  {
    id: "seven-point",
    title: WEAVE.presetSevenPoint,
    description: "Seven turns. Start from the resolution if you like, then fill backward.",
    threads: [
      { key: "opening", title: "Opening" },
      { key: "middle", title: "Middle" },
      { key: "ending", title: "Ending" },
    ],
    beats: [
      { title: "Hook", prompt: "The opposite of the resolution. Who are they before the change?", threadKey: "opening" },
      { title: "Plot turn 1", prompt: "The event that moves them from the hook into the conflict.", threadKey: "opening" },
      { title: "Pinch 1", prompt: "Pressure applies. The opposing force shows what it can do.", threadKey: "middle" },
      { title: "Midpoint", prompt: "They shift from reacting to acting.", threadKey: "middle" },
      { title: "Pinch 2", prompt: "The opposing force strikes harder, often because of the midpoint.", threadKey: "middle" },
      { title: "Plot turn 2", prompt: "The last piece they need to make the resolution possible.", threadKey: "ending" },
      { title: "Resolution", prompt: "The hook's opposite, earned. Show the change in action.", threadKey: "ending" },
    ],
    links: [
      { from: 0, to: 6, note: "The hook and the resolution are opposites." },
    ],
  },
  {
    id: "romance",
    title: WEAVE.presetRomance,
    description: "Attraction, the barrier, and the choice to stay. Seven beats.",
    threads: [
      { key: "attraction", title: "Attraction" },
      { key: "conflict", title: "Conflict" },
      { key: "commitment", title: "Commitment" },
    ],
    beats: [
      { title: "Meet", prompt: "They encounter each other. Note what each thinks the other is.", threadKey: "attraction" },
      { title: "Spark", prompt: "A moment of recognition or desire that neither can quite dismiss.", threadKey: "attraction" },
      { title: "Barrier", prompt: "The reason they should not, or cannot, be together.", threadKey: "conflict" },
      { title: "Deepening", prompt: "Proximity reveals a private truth. Trust grows against the barrier.", threadKey: "conflict" },
      { title: "Break", prompt: "The barrier wins for a while. One of them leaves, lies, or is left.", threadKey: "conflict" },
      { title: "Grand gesture", prompt: "A visible choice that costs something and answers the break.", threadKey: "commitment" },
      { title: "Commitment", prompt: "They choose each other with the truth in view, or they part on purpose.", threadKey: "commitment" },
    ],
    links: [
      { from: 1, to: 6, note: "The spark pays off in the commitment." },
      { from: 2, to: 5, note: "The barrier is faced in the grand gesture." },
    ],
  },
  {
    id: "mystery",
    title: WEAVE.presetMystery,
    description: "A clue trail, a false lead, and a reveal. Seven beats.",
    threads: [
      { key: "investigation", title: "Investigation" },
      { key: "misdirection", title: "Misdirection" },
      { key: "solution", title: "Solution" },
    ],
    beats: [
      { title: "Crime discovered", prompt: "What is wrong, who notices, and what they do not yet understand.", threadKey: "investigation" },
      { title: "First clue", prompt: "A true detail that will still matter at the reveal. Plant it plainly.", threadKey: "investigation" },
      { title: "Suspects", prompt: "Name who could have done it, and what each is hiding.", threadKey: "investigation" },
      { title: "Red herring", prompt: "A convincing false lead. It should be fair, and it should cost someone.", threadKey: "misdirection" },
      { title: "Second clue", prompt: "A detail that contradicts the red herring if the reader looks twice.", threadKey: "misdirection" },
      { title: "Reversal", prompt: "The false lead collapses. The remaining explanation should feel inevitable.", threadKey: "solution" },
      { title: "Reveal", prompt: "Show how the first clue and the second clue name the truth.", threadKey: "solution" },
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
