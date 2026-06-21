// POST /api/generate — turn a plain-language description into an environment spec.
//
// Routes to Opus 4.8 through HUD's OpenAI-compatible inference gateway
// (inference.hud.ai) so only the single HUD_API_KEY is needed — no separate
// Anthropic key. The model is forced to return one JSON tool call matching the
// EnvSpec schema (see src/lib/generate.ts); the client maps that into the block
// tree. We deliberately ask for a SIMPLE environment (few tools, a handful of
// tasks) — the builder is for getting something runnable fast, not exhaustive.

import OpenAI from "openai";
import { ENV_SPEC_SCHEMA } from "@/lib/generate";

export const runtime = "nodejs";
export const maxDuration = 60;

const GATEWAY_URL = process.env.HUD_GATEWAY_URL || "https://inference.hud.ai/v1";
// Opus 4.8 via the gateway. Override with SYNTH_GEN_MODEL if needed.
const MODEL = process.env.SYNTH_GEN_MODEL || "claude-opus-4-8";

const SYSTEM = `You design a reinforcement-learning environment for the HUD platform from a plain-language description, by filling in the emit_environment tool.

An environment has:
- A short description of what the agent does, and optional setup notes.
- Zero or more tools — actions the agent can take. Only add a tool if the task genuinely needs the agent to act (look something up, run something). A pure question-answering environment needs no tools.
- A taskset — concrete tasks the agent is tested and trained on. Each task is a question/prompt plus a rubric: 1-2 "good" answers (what earns reward) and optionally 1 "bad" answer (a tempting wrong answer that earns nothing).

Keep it SIMPLE and runnable, not exhaustive:
- At most 2 tools, and often none.
- 3-5 tasks, each focused and self-contained.
- Each rubric "good" entry describes what a correct answer must contain — concrete, checkable, one short sentence.
- Plain language throughout. No code, no JSON, no jargon.
- Give the environment a short, human title for "name".

Honor the user's intent, but if their description is broad, pick a small, concrete slice of it. Call emit_environment exactly once.`;

export async function POST(req: Request) {
  let body: { prompt?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    return Response.json({ error: "A description is required." }, { status: 400 });
  }

  const key = process.env.HUD_API_KEY;
  if (!key) {
    return Response.json(
      { error: "Generation is unavailable — HUD_API_KEY is not configured." },
      { status: 503 },
    );
  }

  const client = new OpenAI({ apiKey: key, baseURL: GATEWAY_URL });

  try {
    const resp = await client.chat.completions.create({
      model: MODEL,
      max_tokens: 4096,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: prompt },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "emit_environment",
            description: "Emit the environment specification.",
            parameters: ENV_SPEC_SCHEMA,
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "emit_environment" } },
    });

    const msg = resp.choices[0]?.message;
    const call = msg?.tool_calls?.[0];
    const args =
      call && call.type === "function" ? call.function.arguments : extractJson(msg?.content);
    if (!args) {
      return Response.json(
        { error: "The model did not return an environment. Try rephrasing." },
        { status: 502 },
      );
    }

    let spec: unknown;
    try {
      spec = JSON.parse(args);
    } catch {
      return Response.json({ error: "The model returned malformed output." }, { status: 502 });
    }
    return Response.json({ spec });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Generation failed.";
    return Response.json({ error: message }, { status: 500 });
  }
}

/** Some models answer with a raw JSON blob instead of a tool call. */
function extractJson(content: string | null | undefined): string | null {
  if (!content) return null;
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  return content.slice(start, end + 1);
}
