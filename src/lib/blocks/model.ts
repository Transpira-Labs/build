// The block model: the working document the canvas edits, plus the registry of
// block types and the typing rules that decide which sub-blocks may snap into
// which container. This is the single source of truth for the editor UI.
//
// Scratch-style: the canvas starts blank. The user drags container blocks out of
// the palette onto the canvas (each gets an x/y position) and snaps sub-blocks
// into them. For the backend the doc is projected into the canonical IR — see
// ../ir/schema.ts (toIR).

import { nanoid } from "nanoid";

// ---------------------------------------------------------------------------
// Kinds
// ---------------------------------------------------------------------------

/** The four container ("C-shaped") block kinds. */
export type ContainerKind = "environment" | "tool" | "task" | "train";

/** The sub-block kinds that snap inside containers. */
export type SubKind =
  | "goal" // Environment: the overall objective
  | "input" // Environment: what goes in
  | "output" // Environment: what comes out
  | "what_it_does" // Tool: what the action does
  | "question" // Task: the prompt shown to the helper
  | "reward" // Task: how the answer earns points
  | "setting"; // Train: practice settings

/** How a sub-block stores its value. */
export type ValueType = "text" | "reward" | "setting";

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

export type RewardComparator =
  | "equals"
  | "contains"
  | "is_at_least"
  | "is_at_most";

export interface RewardExample {
  id: string;
  answer: string;
  label: "right" | "wrong";
}

export interface RewardValue {
  mode: "guided" | "advanced";
  points: number;
  comparator: RewardComparator;
  target: string;
  freeText: string;
  examples: RewardExample[];
}

export interface SettingValue {
  episodes: number;
  baseModel: string;
  learnFrom: string;
}

// ---------------------------------------------------------------------------
// Document shape
// ---------------------------------------------------------------------------

export interface SubBlock {
  id: string;
  kind: SubKind;
  text?: string;
  reward?: RewardValue;
  setting?: SettingValue;
}

export interface ContainerInstance {
  id: string;
  kind: ContainerKind;
  /** Tool / Task carry a short name in the header. */
  name?: string;
  /** Position on the canvas. */
  x: number;
  y: number;
  subBlocks: SubBlock[];
}

export interface ProjectDoc {
  id: string;
  name: string;
  version: number;
  /** Every block placed on the canvas, in z-order. */
  blocks: ContainerInstance[];
}

// ---------------------------------------------------------------------------
// Registry: sub-block definitions
// ---------------------------------------------------------------------------

export interface SubBlockDef {
  kind: SubKind;
  label: string;
  hint: string;
  placeholder: string;
  /** Which container kind this sub-block belongs in (typed slot). */
  container: ContainerKind;
  valueType: ValueType;
  icon: string;
}

export const SUB_BLOCKS: Record<SubKind, SubBlockDef> = {
  goal: {
    kind: "goal",
    label: "Goal",
    hint: "What should the helper try to do?",
    placeholder: "e.g. Tell the user how many times a letter shows up in a word.",
    container: "environment",
    valueType: "text",
    icon: "🎯",
  },
  input: {
    kind: "input",
    label: "What goes in",
    hint: "What does the helper get to work with?",
    placeholder: "e.g. A word, and a letter to look for.",
    container: "environment",
    valueType: "text",
    icon: "📥",
  },
  output: {
    kind: "output",
    label: "What comes out",
    hint: "What should the helper give back?",
    placeholder: "e.g. A number: how many times the letter appears.",
    container: "environment",
    valueType: "text",
    icon: "📤",
  },
  what_it_does: {
    kind: "what_it_does",
    label: "What it does",
    hint: "Describe the action in plain words.",
    placeholder: "e.g. Counts how many times one letter appears in some text.",
    container: "tool",
    valueType: "text",
    icon: "⚙️",
  },
  question: {
    kind: "question",
    label: "Question",
    hint: "What do we ask the helper?",
    placeholder: 'e.g. How many r’s are in the word "strawberry"?',
    container: "task",
    valueType: "text",
    icon: "❓",
  },
  reward: {
    kind: "reward",
    label: "Reward",
    hint: "How does an answer earn points?",
    placeholder: "",
    container: "task",
    valueType: "reward",
    icon: "⭐",
  },
  setting: {
    kind: "setting",
    label: "Setting",
    hint: "How much practice, and what to learn from.",
    placeholder: "",
    container: "train",
    valueType: "setting",
    icon: "🎛️",
  },
};

// ---------------------------------------------------------------------------
// Registry: container definitions
// ---------------------------------------------------------------------------

export interface ContainerDef {
  kind: ContainerKind;
  /** Header label / category name. */
  label: string;
  blurb: string;
  /** Sub-block kinds allowed inside (typed slots). */
  allowed: SubKind[];
  /** Only one of these can exist in a project. */
  singleton: boolean;
  /** Has an editable short name in the header (Tool / Task). */
  hasName: boolean;
  icon: string;
  /** Warm-alpine category palette (hex), applied via inline styles so the hues
   *  harmonize with the platform's cream/brown/orange system. */
  palette: {
    /** Header bar + palette chip fill. */
    base: string;
    /** A darker shade for the notch / shadow edge. */
    deep: string;
    /** Light tint for the C-block body. */
    soft: string;
    /** Text colour that sits on `base`. */
    on: string;
  };
}

export const CONTAINERS: Record<ContainerKind, ContainerDef> = {
  environment: {
    kind: "environment",
    label: "Helper",
    blurb: "What this helper is all about.",
    allowed: ["goal", "input", "output"],
    singleton: true,
    hasName: false,
    icon: "🤖",
    // terracotta orange — the brand accent
    palette: { base: "#C2622F", deep: "#A14E22", soft: "#F4E4D6", on: "#FFFFFF" },
  },
  tool: {
    kind: "tool",
    label: "Tool",
    blurb: "Something the helper can do.",
    allowed: ["what_it_does"],
    singleton: false,
    hasName: true,
    icon: "🔧",
    // sage / pine green
    palette: { base: "#6E8B6A", deep: "#566F52", soft: "#E5EBE0", on: "#FFFFFF" },
  },
  task: {
    kind: "task",
    label: "Challenge",
    blurb: "One thing to test the helper on.",
    allowed: ["question", "reward"],
    singleton: false,
    hasName: true,
    icon: "🎲",
    // clay red
    palette: { base: "#B0503E", deep: "#8E3E30", soft: "#F3E0DB", on: "#FFFFFF" },
  },
  train: {
    kind: "train",
    label: "Practice",
    blurb: "How the helper gets better.",
    allowed: ["setting"],
    singleton: true,
    hasName: false,
    icon: "🏆",
    // goldenrod
    palette: { base: "#C08A2D", deep: "#9E7022", soft: "#F4EAD4", on: "#FFFFFF" },
  },
};

/** Category / palette order. */
export const CATEGORY_ORDER: ContainerKind[] = [
  "environment",
  "tool",
  "task",
  "train",
];

// ---------------------------------------------------------------------------
// Typing rules
// ---------------------------------------------------------------------------

export function isAllowed(sub: SubKind, container: ContainerKind): boolean {
  return CONTAINERS[container].allowed.includes(sub);
}

export function hasSub(instance: ContainerInstance, sub: SubKind): boolean {
  return instance.subBlocks.some((b) => b.kind === sub);
}

export function subKindsFor(kind: ContainerKind): SubKind[] {
  return CONTAINERS[kind].allowed;
}

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

export function defaultReward(): RewardValue {
  return {
    mode: "guided",
    points: 1,
    comparator: "equals",
    target: "",
    freeText: "",
    examples: [],
  };
}

export function defaultSetting(): SettingValue {
  return {
    episodes: 100,
    baseModel: "qwen3-8b",
    learnFrom: "Learn from the answers that earned points.",
  };
}

export function makeSubBlock(kind: SubKind): SubBlock {
  const def = SUB_BLOCKS[kind];
  const block: SubBlock = { id: nanoid(8), kind };
  if (def.valueType === "text") block.text = "";
  if (def.valueType === "reward") block.reward = defaultReward();
  if (def.valueType === "setting") block.setting = defaultSetting();
  return block;
}

export function makeContainer(
  kind: ContainerKind,
  x: number,
  y: number,
): ContainerInstance {
  return { id: nanoid(8), kind, x, y, subBlocks: [] };
}

/** A fresh project with a blank canvas. */
export function emptyProject(name = "My helper"): ProjectDoc {
  return { id: nanoid(10), name, version: 1, blocks: [] };
}

/** First placed block of a kind (for singletons + IR projection). */
export function firstOfKind(
  doc: ProjectDoc,
  kind: ContainerKind,
): ContainerInstance | undefined {
  return doc.blocks.find((b) => b.kind === kind);
}
