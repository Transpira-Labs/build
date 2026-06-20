// The canonical IR — the source of truth the backend compiles, checks, and
// deploys. The block canvas edits a ProjectDoc (see ../blocks/model.ts); `toIR`
// projects that doc into this normalized shape. Generated HUD code is derived
// from the IR, never the other way around.

import { z } from "zod";
import { firstOfKind, type ProjectDoc, type RewardValue } from "../blocks/model";

export const toolBackendSchema = z.object({
  // v1 ships "stub"; "fixture" and "api" are reserved for later.
  type: z.enum(["stub", "fixture", "api"]).default("stub"),
});

export const toolSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  backend: toolBackendSchema,
});

export const rewardSchema = z.object({
  mode: z.enum(["guided", "advanced"]),
  /** Human-readable, deterministic scoring rule, e.g. `answer == 3 -> 1.0 else 0.0`. */
  spec: z.string(),
});

export const taskSchema = z.object({
  id: z.string(),
  name: z.string(),
  prompt: z.string(),
  reward: rewardSchema,
  /** Parameterized variants → taskset (added in a later step). */
  variants: z.array(z.record(z.string(), z.unknown())).default([]),
});

export const environmentSchema = z.object({
  objective: z.string(),
  inputs: z.string(),
  outputs: z.string(),
});

export const trainSchema = z.object({
  algorithm: z.string(),
  base_model: z.string(),
  episodes: z.number().int().nonnegative(),
  eval_split: z.number().min(0).max(1),
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
// Reward spec generation (guided → deterministic string)
// ---------------------------------------------------------------------------

const COMPARATOR_OP: Record<RewardValue["comparator"], string> = {
  equals: "==",
  contains: "contains",
  is_at_least: ">=",
  is_at_most: "<=",
};

/** Turn a reward block into a plain, deterministic scoring rule. */
export function rewardToSpec(reward: RewardValue): string {
  if (reward.mode === "advanced") {
    return reward.freeText.trim();
  }
  const op = COMPARATOR_OP[reward.comparator];
  const target = reward.target.trim() || "?";
  const pts = reward.points.toFixed(1);
  const lhs =
    op === "contains" ? `answer contains "${target}"` : `answer ${op} ${target}`;
  return `${lhs} -> ${pts} else 0.0`;
}

// ---------------------------------------------------------------------------
// Projection: ProjectDoc → IR
// ---------------------------------------------------------------------------

function textOf(
  instance: { subBlocks: { kind: string; text?: string }[] },
  kind: string,
): string {
  return instance.subBlocks.find((b) => b.kind === kind)?.text?.trim() ?? "";
}

/** Project the editor document into the canonical IR. Pure and deterministic. */
export function toIR(doc: ProjectDoc): IR {
  const env = firstOfKind(doc, "environment");

  const tools: IRTool[] = doc.blocks
    .filter((b) => b.kind === "tool")
    .map((t) => ({
      id: t.id,
      name: t.name?.trim() || "tool",
      description: textOf(t, "what_it_does"),
      backend: { type: "stub" as const },
    }));

  const tasks: IRTask[] = doc.blocks
    .filter((b) => b.kind === "task")
    .map((t) => {
      const reward = t.subBlocks.find((b) => b.kind === "reward")?.reward;
      return {
        id: t.id,
        name: t.name?.trim() || "challenge",
        prompt: textOf(t, "question"),
        reward: {
          mode: reward?.mode ?? "guided",
          spec: reward ? rewardToSpec(reward) : "",
        },
        variants: [],
      };
    });

  const setting = firstOfKind(doc, "train")?.subBlocks.find(
    (b) => b.kind === "setting",
  )?.setting;

  return {
    project: { id: doc.id, name: doc.name, version: doc.version },
    environment: {
      objective: env ? textOf(env, "goal") : "",
      inputs: env ? textOf(env, "input") : "",
      outputs: env ? textOf(env, "output") : "",
    },
    tools,
    tasks,
    train: {
      algorithm: "grpo",
      base_model: setting?.baseModel ?? "qwen3-8b",
      episodes: setting?.episodes ?? 100,
      eval_split: 0.2,
    },
  };
}
