// "Generate from a prompt": turn a plain-language description into a ready-to-edit
// environment. The /api/generate route asks Opus 4.8 (via the HUD gateway) to fill
// in the EnvSpec below; here we validate that spec and project it into a ProjectDoc
// by going through the canonical IR (so the result is identical to anything the
// editor itself produces). The schema is intentionally small — the system prompt
// pushes the model toward a simple, runnable environment, not an exhaustive one.

import { z } from "zod";
import { nanoid } from "nanoid";
import { fromIR, type IR } from "@/lib/ir/schema";
import { defaultTrain, type ProjectDoc } from "@/lib/blocks/model";
import { apiErrorFrom } from "@/lib/apiError";

// The JSON schema handed to the model as the emit_environment tool parameters.
// Kept in plain JSON Schema (not derived from Zod) so it travels to the gateway
// verbatim; envSpecSchema below is the matching runtime validator.
export const ENV_SPEC_SCHEMA = {
  type: "object",
  properties: {
    name: {
      type: "string",
      description: "A short, human title for the environment (a few words).",
    },
    description: {
      type: "string",
      description: "One or two sentences on what the agent does in this environment.",
    },
    setup: {
      type: "string",
      description: "Optional extra setup notes. Leave empty if none.",
    },
    tools: {
      type: "array",
      description: "Actions the agent can take. Often empty. At most 2.",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "Short tool name, e.g. 'search_docs'." },
          description: { type: "string", description: "What the tool does / is for." },
          inputs: { type: "string", description: "What the tool takes in." },
          returns: { type: "string", description: "What the tool gives back." },
        },
        required: ["name", "description"],
      },
    },
    tasks: {
      type: "array",
      description: "3-5 concrete tasks to test and train on.",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "Short task label." },
          prompt: { type: "string", description: "The question/instruction given to the agent." },
          good: {
            type: "array",
            description: "1-2 descriptions of what a correct answer must contain.",
            items: { type: "string" },
          },
          bad: {
            type: "array",
            description: "Optional: a tempting wrong answer that earns no reward.",
            items: { type: "string" },
          },
        },
        required: ["prompt", "good"],
      },
    },
  },
  required: ["name", "description", "tasks"],
} as const;

export const envSpecSchema = z.object({
  name: z.string(),
  description: z.string(),
  setup: z.string().optional(),
  tools: z
    .array(
      z.object({
        name: z.string(),
        description: z.string(),
        inputs: z.string().optional(),
        returns: z.string().optional(),
      }),
    )
    .optional(),
  tasks: z.array(
    z.object({
      name: z.string().optional(),
      prompt: z.string(),
      good: z.array(z.string()).default([]),
      bad: z.array(z.string()).optional(),
    }),
  ),
});

export type EnvSpec = z.infer<typeof envSpecSchema>;

/** Build an editable ProjectDoc from a generated spec, via the canonical IR. */
export function docFromSpec(spec: EnvSpec): ProjectDoc {
  const train = defaultTrain();
  const ir: IR = {
    project: { id: nanoid(10), name: spec.name?.trim() || "Generated environment", version: 1 },
    environment: {
      description: spec.description?.trim() ?? "",
      setup: spec.setup?.trim() ?? "",
    },
    tools: (spec.tools ?? []).map((t) => ({
      id: nanoid(8),
      name: t.name?.trim() || "tool",
      description: t.description?.trim() ?? "",
      inputs: t.inputs?.trim() ?? "",
      returns: t.returns?.trim() ?? "",
      backend: { type: "stub" as const },
    })),
    tasks: spec.tasks.map((t, i) => ({
      id: nanoid(8),
      name: t.name?.trim() || `Task ${i + 1}`,
      prompt: t.prompt?.trim() ?? "",
      references: [],
      rubric: {
        good: (t.good ?? []).map((g) => g.trim()).filter(Boolean),
        bad: (t.bad ?? []).map((b) => b.trim()).filter(Boolean),
      },
      variants: [],
    })),
    train: {
      algorithm: "auto",
      base_model: train.model,
      set_size: train.setSize,
      improvement: train.improvement,
    },
  };
  return fromIR(ir);
}

/** Call the generate API and return a ready-to-save ProjectDoc. Throws on failure. */
export async function generateEnvironment(prompt: string): Promise<ProjectDoc> {
  const res = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw apiErrorFrom(res.status, data, `Generation failed (${res.status}).`);
  }
  const parsed = envSpecSchema.safeParse(data?.spec);
  if (!parsed.success) {
    throw new Error("The generated environment didn't match the expected shape.");
  }
  return docFromSpec(parsed.data);
}
