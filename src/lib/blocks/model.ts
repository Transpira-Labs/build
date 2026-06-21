// The block model: a recursive tree of blocks plus the registry that defines
// every block kind and the typing rules. Single source of truth for the editor.
//
// Blocks nest to any depth. A block has a role:
//   - "main"  — one of the four top-level blocks placed on the canvas (x/y)
//   - "group" — a nestable container that holds other blocks (e.g. Scoring)
//   - "leaf"  — holds a value (text / choice / number / reference)
// `accepts` lists which child kinds a main/group block can hold; this is the
// typing rule for snapping. The tree projects into the canonical IR (../ir).

import { nanoid } from "nanoid";

// ---------------------------------------------------------------------------
// Kinds
// ---------------------------------------------------------------------------

export type BlockKind =
  // main (canvas-level)
  | "environment"
  | "tool"
  | "task"
  | "train"
  // group (nestable)
  | "scoring"
  // leaf
  | "overview"
  | "setup"
  | "goal"
  | "input"
  | "output"
  | "reference"
  | "prompt"
  | "good_outcome"
  | "bad_outcome"
  | "model"
  | "set_size"
  | "improvement";

/** The four top-level block kinds. */
export type MainKind = "environment" | "tool" | "task" | "train";

export type BlockRole = "main" | "group" | "leaf";
export type ValueType = "text" | "choice" | "number" | "reference";

export const MAIN_KINDS: MainKind[] = ["environment", "tool", "task", "train"];

// ---------------------------------------------------------------------------
// Values + tree
// ---------------------------------------------------------------------------

export interface ReferenceValue {
  mode: "link" | "upload";
  value: string;
}

export interface Block {
  id: string;
  kind: BlockKind;
  /** Named blocks (Tool / Task). */
  name?: string;
  /** Canvas position (top-level main blocks only). */
  x?: number;
  y?: number;
  /** Leaf values. */
  text?: string;
  num?: number;
  reference?: ReferenceValue;
  /** Nested blocks. */
  children: Block[];
}

export interface ProjectDoc {
  id: string;
  name: string;
  version: number;
  /** Top-level main blocks, in z-order. */
  blocks: Block[];
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export interface BlockDef {
  kind: BlockKind;
  role: BlockRole;
  label: string;
  hint: string;
  /** Longer explanation for the "?" help popover (main/group). */
  help?: string;
  color: string;
  /** Body tint (main/group). */
  tint?: string;
  /** Child kinds this block accepts (main/group). */
  accepts?: BlockKind[];
  /** Child kinds auto-added when this block is created (the "needed" ones). */
  defaults?: BlockKind[];
  /** Multiple allowed under the same parent. */
  repeatable?: boolean;
  /** Only one allowed on the canvas (main). */
  singleton?: boolean;
  /** Editable name in the header (main). */
  hasName?: boolean;
  /** Leaf value type + options. */
  valueType?: ValueType;
  options?: { value: string; label: string }[];
  number?: { min: number; max: number; step: number; unit: string; default: number };
}

// Function-based accent colours.
const IO = "#5A7691";
const GOOD = "#4F8A5B";
const BAD = "#B0503E";
const CFG = "#8C7B63";

export const BLOCKS: Record<BlockKind, BlockDef> = {
  // --- main --------------------------------------------------------------
  environment: {
    kind: "environment",
    role: "main",
    label: "Environment",
    hint: "The big picture.",
    help: "Describe what the whole thing is and any setup it needs. Just one.",
    color: "#BE5A2E",
    tint: "#F6E7DA",
    accepts: ["overview", "setup"],
    defaults: ["overview"],
    singleton: true,
  },
  tool: {
    kind: "tool",
    role: "main",
    label: "Tool",
    hint: "Something the agent can do.",
    help: "An action the agent can use. Add as many as you want.",
    color: "#3F7A74",
    tint: "#E2EEEC",
    accepts: ["goal", "input", "output"],
    defaults: ["goal", "input", "output"],
    hasName: true,
  },
  task: {
    kind: "task",
    role: "main",
    label: "Task",
    hint: "One thing to test.",
    help: "A question and how to score the answer. Add one per test.",
    color: "#9C4A55",
    tint: "#F1E3E5",
    // Keep it minimal: just the question, any attached inputs, and scoring.
    // The compile LLM reasons out the rest (I/O, tools) from these + the rubric.
    accepts: ["prompt", "reference", "scoring"],
    defaults: ["prompt", "scoring"],
    hasName: true,
  },
  train: {
    kind: "train",
    role: "main",
    label: "Train",
    hint: "How it learns.",
    help: "Pick a model, how much practice, and what 'better' means.",
    color: "#B07D2A",
    tint: "#F4EBD6",
    accepts: ["model", "set_size", "improvement"],
    defaults: ["model", "set_size", "improvement"],
    singleton: true,
  },

  // --- group -------------------------------------------------------------
  scoring: {
    kind: "scoring",
    role: "group",
    label: "Scoring",
    hint: "How to score answers.",
    help: "Add good and bad answers to score by.",
    color: GOOD,
    tint: "#E6F0E4",
    accepts: ["good_outcome", "bad_outcome"],
    // Starts empty; the user adds good (and optionally bad) answers themselves.
    defaults: [],
  },

  // --- leaf: ins & outs --------------------------------------------------
  input: {
    kind: "input",
    role: "leaf",
    label: "What goes in",
    hint: "What it gets.",
    color: IO,
    valueType: "text",
  },
  output: {
    kind: "output",
    role: "leaf",
    label: "What comes out",
    hint: "What it gives back.",
    color: IO,
    valueType: "text",
  },
  reference: {
    kind: "reference",
    role: "leaf",
    label: "Attached info",
    hint: "A link or file.",
    color: IO,
    valueType: "reference",
    repeatable: true,
  },
  prompt: {
    kind: "prompt",
    role: "leaf",
    label: "Question",
    hint: "What you ask.",
    color: IO,
    valueType: "text",
  },

  // --- leaf: scoring -----------------------------------------------------
  good_outcome: {
    kind: "good_outcome",
    role: "leaf",
    label: "Good answer",
    hint: "Earns points.",
    color: GOOD,
    valueType: "text",
    repeatable: true,
  },
  bad_outcome: {
    kind: "bad_outcome",
    role: "leaf",
    label: "Bad answer",
    hint: "Earns no points.",
    color: BAD,
    valueType: "text",
    repeatable: true,
  },

  // --- leaf: environment overview ---------------------------------------
  overview: {
    kind: "overview",
    role: "leaf",
    label: "Overview",
    hint: "What it does, in one line.",
    color: CFG,
    valueType: "text",
  },
  setup: {
    kind: "setup",
    role: "leaf",
    label: "Setup notes",
    hint: "Any extra setup it needs.",
    color: CFG,
    valueType: "text",
  },

  // --- leaf: settings ----------------------------------------------------
  goal: {
    kind: "goal",
    role: "leaf",
    label: "Goal",
    hint: "What it's for.",
    color: CFG,
    valueType: "text",
  },
  model: {
    kind: "model",
    role: "leaf",
    label: "Model",
    hint: "Which model.",
    color: CFG,
    valueType: "choice",
    options: [
      { value: "qwen3-8b", label: "Small & fast" },
      { value: "qwen3-14b", label: "Medium" },
      { value: "qwen3-32b", label: "Big & careful" },
    ],
  },
  set_size: {
    kind: "set_size",
    role: "leaf",
    label: "Practice amount",
    hint: "How many rounds.",
    color: CFG,
    valueType: "number",
    number: { min: 50, max: 5000, step: 50, unit: "rounds", default: 500 },
  },
  improvement: {
    kind: "improvement",
    role: "leaf",
    label: "Getting better",
    hint: "What 'better' means.",
    color: CFG,
    valueType: "text",
  },
};

// ---------------------------------------------------------------------------
// Typing rules
// ---------------------------------------------------------------------------

export function isAllowed(child: BlockKind, parent: BlockKind): boolean {
  return BLOCKS[parent].accepts?.includes(child) ?? false;
}

/** Can another child of this kind be added to the parent block right now? */
export function canAdd(parent: Block, child: BlockKind): boolean {
  if (!isAllowed(child, parent.kind)) return false;
  if (BLOCKS[child].repeatable) return true;
  return !parent.children.some((c) => c.kind === child);
}

export function isRequired(parentKind: BlockKind, child: BlockKind): boolean {
  return BLOCKS[parentKind].defaults?.includes(child) ?? false;
}

export interface Descendant {
  kind: BlockKind;
  depth: number;
  /** The kind whose `accepts` includes this one. */
  parent: BlockKind;
}

/** All block kinds reachable beneath a block, with nesting depth + parent. */
export function descendants(
  kind: BlockKind,
  depth = 0,
  seen: Set<BlockKind> = new Set(),
): Descendant[] {
  const out: Descendant[] = [];
  for (const child of BLOCKS[kind].accepts ?? []) {
    if (seen.has(child)) continue;
    seen.add(child);
    out.push({ kind: child, depth, parent: kind });
    out.push(...descendants(child, depth + 1, seen));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

export function makeBlock(kind: BlockKind): Block {
  const def = BLOCKS[kind];
  const block: Block = { id: nanoid(8), kind, children: [] };
  switch (def.valueType) {
    case "text":
      block.text = "";
      break;
    case "choice":
      block.text = def.options?.[0]?.value ?? "";
      break;
    case "number":
      block.num = def.number?.default ?? 0;
      break;
    case "reference":
      block.reference = { mode: "link", value: "" };
      break;
  }
  // Recursively include the always-needed children.
  block.children = (def.defaults ?? []).map(makeBlock);
  return block;
}

export function makeMain(kind: MainKind, x: number, y: number): Block {
  return { ...makeBlock(kind), x, y };
}

export function emptyProject(name = "Untitled environment"): ProjectDoc {
  return { id: nanoid(10), name, version: 1, blocks: [] };
}

export function firstMain(doc: ProjectDoc, kind: MainKind): Block | undefined {
  return doc.blocks.find((b) => b.kind === kind);
}

// ---------------------------------------------------------------------------
// Tree operations (pure)
// ---------------------------------------------------------------------------

export function findBlock(forest: Block[], id: string): Block | undefined {
  for (const b of forest) {
    if (b.id === id) return b;
    const found = findBlock(b.children, id);
    if (found) return found;
  }
  return undefined;
}

/** Path from a root main block down to the block with `id` (inclusive). */
export function findPath(forest: Block[], id: string): Block[] | null {
  for (const b of forest) {
    if (b.id === id) return [b];
    const sub = findPath(b.children, id);
    if (sub) return [b, ...sub];
  }
  return null;
}

export function mapBlock(
  forest: Block[],
  id: string,
  fn: (b: Block) => Block,
): Block[] {
  return forest.map((b) => {
    if (b.id === id) return fn(b);
    if (b.children.length) {
      return { ...b, children: mapBlock(b.children, id, fn) };
    }
    return b;
  });
}

export function removeFromForest(forest: Block[], id: string): Block[] {
  return forest
    .filter((b) => b.id !== id)
    .map((b) =>
      b.children.length ? { ...b, children: removeFromForest(b.children, id) } : b,
    );
}

/** Nearest block at or above `startId` that can accept a `child`. */
export function nearestAccepting(
  forest: Block[],
  startId: string,
  child: BlockKind,
): string | null {
  const path = findPath(forest, startId);
  if (!path) return null;
  for (let i = path.length - 1; i >= 0; i--) {
    if (canAdd(path[i], child)) return path[i].id;
  }
  return null;
}

/** First block in this subtree (root first, then depth-first) that can accept `child`. */
export function findAccepting(root: Block, child: BlockKind): Block | null {
  if (canAdd(root, child)) return root;
  for (const c of root.children) {
    const found = findAccepting(c, child);
    if (found) return found;
  }
  return null;
}
