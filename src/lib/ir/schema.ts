// The canonical IR — the source of truth the backend compiles, checks, and
// deploys. The block canvas edits a recursive ProjectDoc (../blocks/model.ts);
// `toIR` projects it into this normalized shape. Generated HUD code derives
// from the IR.

import { z } from "zod";
import {
  BLOCKS,
  firstMain,
  type Block,
  type BlockKind,
  type ProjectDoc,
} from "../blocks/model";

export const referenceSchema = z.object({
  mode: z.enum(["link", "upload"]),
  value: z.string(),
});

export const toolSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  inputs: z.string(),
  returns: z.string(),
  backend: z.object({ type: z.enum(["stub", "fixture", "api"]).default("stub") }),
});

export const rubricSchema = z.object({
  good: z.array(z.string()),
  bad: z.array(z.string()),
});

export const taskSchema = z.object({
  id: z.string(),
  name: z.string(),
  prompt: z.string(),
  references: z.array(referenceSchema),
  rubric: rubricSchema,
  variants: z.array(z.record(z.string(), z.unknown())).default([]),
});

export const environmentSchema = z.object({
  /** High-level description of the environment. */
  description: z.string(),
  /** Any general setup info HUD needs, beyond tools/tasks. */
  setup: z.string(),
});

export const trainSchema = z.object({
  algorithm: z.string(),
  base_model: z.string(),
  set_size: z.number().int().nonnegative(),
  improvement: z.string(),
});

export const compiledSchema = z.object({
  ir_hash: z.string(),
  artifact_path: z.string().nullable(),
  status: z.enum(["valid", "stale", "error", "empty"]),
});

export const irSchema = z.object({
  project: z.object({
    id: z.string(),
    name: z.string(),
    version: z.number().int().positive(),
  }),
  environment: environmentSchema,
  tools: z.array(toolSchema),
  tasks: z.array(taskSchema),
  train: trainSchema,
  compiled: compiledSchema.optional(),
});

export type IR = z.infer<typeof irSchema>;
export type IRTool = z.infer<typeof toolSchema>;
export type IRTask = z.infer<typeof taskSchema>;

// ---------------------------------------------------------------------------
// Projection helpers (over direct children)
// ---------------------------------------------------------------------------

function childText(block: Block | undefined, kind: BlockKind): string {
  return block?.children.find((c) => c.kind === kind)?.text?.trim() ?? "";
}

/** Collect text of a kind nested anywhere beneath a block (e.g. inside Scoring). */
function deepText(block: Block, kind: BlockKind): string[] {
  const out: string[] = [];
  for (const c of block.children) {
    if (c.kind === kind && c.text?.trim()) out.push(c.text.trim());
    out.push(...deepText(c, kind));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Projection: ProjectDoc → IR
// ---------------------------------------------------------------------------

/** Every block of a kind anywhere in the tree (Tasks live inside the Taskset). */
function collect(forest: Block[], kind: BlockKind, out: Block[] = []): Block[] {
  for (const b of forest) {
    if (b.kind === kind) out.push(b);
    collect(b.children, kind, out);
  }
  return out;
}

export function toIR(doc: ProjectDoc): IR {
  const env = firstMain(doc, "environment");

  const tools: IRTool[] = collect(doc.blocks, "tool").map((t) => ({
    id: t.id,
    name: t.name?.trim() || "tool",
    description: childText(t, "goal"),
    inputs: childText(t, "input"),
    returns: childText(t, "output"),
    backend: { type: "stub" as const },
  }));

  const tasks: IRTask[] = collect(doc.blocks, "task").map((t) => ({
      id: t.id,
      name: t.name?.trim() || "task",
      prompt: childText(t, "prompt"),
      references: t.children
        .filter((c) => c.kind === "reference" && c.reference?.value.trim())
        .map((c) => ({ mode: c.reference!.mode, value: c.reference!.value.trim() })),
      // Good/bad answers live inside the nested Scoring group.
      rubric: {
        good: deepText(t, "good_outcome"),
        bad: deepText(t, "bad_outcome"),
      },
      variants: [],
    }));

  const train = firstMain(doc, "train");
  const setSize =
    train?.children.find((c) => c.kind === "set_size")?.num ??
    BLOCKS.set_size.number!.default;

  return {
    project: { id: doc.id, name: doc.name, version: doc.version },
    environment: {
      description: childText(env, "overview"),
      setup: childText(env, "setup"),
    },
    tools,
    tasks,
    train: {
      algorithm: "auto",
      base_model: childText(train, "model") || "qwen3-8b",
      set_size: setSize,
      improvement: childText(train, "improvement"),
    },
  };
}
