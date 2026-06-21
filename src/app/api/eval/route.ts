// POST /api/eval — baseline-eval a deployed HUD taskset (run examples on it).
//
// Local-dev only: shells out to the Python `synth` backend (backend/eval_one.py)
// which drives HUD (`Taskset.from_api` + `taskset.run`) on the beta plane where
// `hud deploy` published the env. Real runs cost HUD compute.
//
// Body: { taskset: string, models?: string[], group?: number, dryRun?: boolean }
// Returns the leaderboard to_dict() (+ ok): { ceiling, solvable, discriminating,
//   models:[{model,mean,per_task}], tasks:[{slug,best,worst,per_model,...}],
//   diagnostics:[...] }

import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

export const runtime = "nodejs";
export const maxDuration = 800; // rollouts on HUD take minutes (dev path)

export async function POST(req: Request) {
  let body: { blocks?: unknown; taskset?: unknown; models?: unknown; group?: unknown; dryRun?: boolean };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const hasBlocks = Array.isArray(body.blocks) && body.blocks.length > 0;
  const taskset = typeof body.taskset === "string" ? body.taskset.trim() : "";
  if (!hasBlocks && !taskset) {
    return Response.json({ error: "blocks[] or taskset required" }, { status: 400 });
  }

  const repoRoot = process.cwd();
  const backendDir = path.join(repoRoot, "backend");
  const py = path.resolve(repoRoot, process.env.SYNTH_PYTHON || "./backend/.venv/bin/python");

  if (!fs.existsSync(py) || !fs.existsSync(path.join(backendDir, "eval_one.py"))) {
    return Response.json(
      { error: "Eval backend not available. Set up the Python venv in /backend and run locally." },
      { status: 503 },
    );
  }
  if (!body.dryRun && !process.env.HUD_API_KEY) {
    return Response.json(
      { error: "HUD_API_KEY is not set on the server (.env.local)." },
      { status: 503 },
    );
  }

  // The Python eval drives HUD's beta plane via the SDK's own default base —
  // drop platform's HUD_API_URL (production) for this child, same as deploy.
  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  delete childEnv.HUD_API_URL;
  // Pass the key only if non-empty — an empty value would override the gateway's
  // ~/.hud/.env fallback and silently stub the env's LLM-generated tools.
  if (process.env.HUD_API_KEY) childEnv.HUD_API_KEY = process.env.HUD_API_KEY;
  else delete childEnv.HUD_API_KEY;

  const args = ["eval_one.py"];
  if (body.dryRun) args.push("--dry-run");

  const child = spawn(py, args, { cwd: backendDir, env: childEnv });

  let out = "";
  let err = "";
  child.stdout.on("data", (d) => (out += d.toString()));
  child.stderr.on("data", (d) => (err += d.toString()));
  child.stdin.write(
    JSON.stringify({
      blocks: hasBlocks ? body.blocks : undefined,
      taskset: taskset || undefined,
      models: Array.isArray(body.models) ? body.models : undefined,
      group: typeof body.group === "number" ? body.group : undefined,
    }),
  );
  child.stdin.end();

  const code: number = await new Promise((resolve) => {
    child.on("close", (c) => resolve(c ?? 0));
    child.on("error", () => resolve(-1));
  });

  const line = out.trim().split("\n").filter(Boolean).pop() ?? "";
  let result: Record<string, unknown>;
  try {
    result = JSON.parse(line);
  } catch {
    return Response.json(
      { error: "backend did not return JSON", code, stdoutTail: out.slice(-2000), logTail: err.slice(-4000) },
      { status: 500 },
    );
  }

  const status = result.ok ? 200 : 500;
  return Response.json({ ...result, code, logTail: err.slice(-6000) }, { status });
}
