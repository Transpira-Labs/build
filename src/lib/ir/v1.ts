// Project IR → the backend's "v1 block" JSON (a flat [{type:"env"|"tool"|"task"}]
// array). The Python `synth` pipeline is schema-tolerant (an LLM extractor
// normalizes whatever we send), but we hand it a clean, canonical shape so the
// offline path works too. The authoritative deployed env name comes *back* from
// the backend; the name here is only an input hint.

import type { IR } from "./schema";

export type V1Block =
  | { type: "env"; name: string; description: string }
  | { type: "tool"; name: string; functionality: string }
  | { type: "task"; prompt: string; answerType: "exact" | "state"; answer: string };

/** HUD env names are slugs — lowercase, underscore-separated, alphanumeric. */
export function envSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 48) || "environment"
  );
}

/** A good answer that looks like a short exact value ("391", "true") vs. a
 *  prose rubric line ("States the population of France ~68M"). */
function looksExact(answer: string): boolean {
  const a = answer.trim();
  return a.length > 0 && a.length <= 40 && !/\s{2,}/.test(a) && a.split(/\s+/).length <= 4;
}

export function toV1Blocks(ir: IR): V1Block[] {
  const blocks: V1Block[] = [];

  const description = [ir.environment.description, ir.environment.setup]
    .map((s) => s.trim())
    .filter(Boolean)
    .join("\n\n");
  blocks.push({ type: "env", name: envSlug(ir.project.name), description });

  for (const t of ir.tools) {
    const functionality = [
      t.description.trim(),
      t.inputs.trim() && `Inputs: ${t.inputs.trim()}`,
      t.returns.trim() && `Returns: ${t.returns.trim()}`,
    ]
      .filter(Boolean)
      .join(" ");
    blocks.push({ type: "tool", name: t.name || "tool", functionality });
  }

  for (const t of ir.tasks) {
    const good = t.rubric.good.map((g) => g.trim()).filter(Boolean);
    const answer = good.join(" ");
    blocks.push({
      type: "task",
      prompt: t.prompt,
      answerType: good.length === 1 && looksExact(good[0]) ? "exact" : "state",
      answer,
    });
  }

  return blocks;
}
