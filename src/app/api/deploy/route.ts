// POST /api/deploy — compile the project to a HUD env and deploy it.
//
// Local-dev only for now: this shells out to the Python `synth` backend
// (backend/deploy_one.py) which runs `hud deploy` (a Docker image build), so it
// needs the local venv + Docker + a HUD_API_KEY. On a host without those (e.g.
// the Vercel build), it returns a clean 503 instead of hanging.
//
// Body: { blocks: V1Block[], dryRun?: boolean }
// Returns the bridge's JSON: { env_name, version, compiled, deployable,
//                              deployed, diagnostics, message, logTail }

import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

export const runtime = "nodejs";
// Docker builds are slow; allow a long-running request (no effect locally, where
// there's no platform timeout — this is the dev path).
export const maxDuration = 800;

export async function POST(req: Request) {
  let body: { blocks?: unknown; dryRun?: boolean };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const blocks = body.blocks;
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return Response.json({ error: "blocks[] required" }, { status: 400 });
  }

  const repoRoot = process.cwd();
  const backendDir = path.join(repoRoot, "backend");
  const py = path.resolve(
    repoRoot,
    process.env.SYNTH_PYTHON || "./backend/.venv/bin/python",
  );

  if (!fs.existsSync(py) || !fs.existsSync(path.join(backendDir, "deploy_one.py"))) {
    return Response.json(
      {
        error:
          "Deploy backend not available. Set up the Python venv (uv venv --python 3.12 && uv pip install -e .) in /backend and run locally.",
      },
      { status: 503 },
    );
  }

  if (!body.dryRun && !process.env.HUD_API_KEY) {
    return Response.json(
      { error: "HUD_API_KEY is not set on the server (.env.local)." },
      { status: 503 },
    );
  }

  const args = ["deploy_one.py"];
  if (body.dryRun) args.push("--dry-run");

  // The `hud deploy` CLI uses its own API base (api.beta.hud.ai). Platform's
  // HUD_API_URL (api.hud.ai) is for the run/trace client — passing it to deploy
  // makes the build-upload endpoint 404, so drop it for this child.
  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  delete childEnv.HUD_API_URL;
  // Pass the key only if non-empty — an empty HUD_API_KEY would override the
  // gateway's ~/.hud/.env fallback and silently stub every LLM-generated tool.
  if (process.env.HUD_API_KEY) childEnv.HUD_API_KEY = process.env.HUD_API_KEY;
  else delete childEnv.HUD_API_KEY;

  const child = spawn(py, args, { cwd: backendDir, env: childEnv });

  let out = "";
  let err = "";
  child.stdout.on("data", (d) => (out += d.toString()));
  child.stderr.on("data", (d) => (err += d.toString()));
  child.stdin.write(JSON.stringify(blocks));
  child.stdin.end();

  const code: number = await new Promise((resolve) => {
    child.on("close", (c) => resolve(c ?? 0));
    child.on("error", () => resolve(-1));
  });

  // The bridge prints exactly one JSON object as its last stdout line.
  const line = out.trim().split("\n").filter(Boolean).pop() ?? "";
  let result: Record<string, unknown>;
  try {
    result = JSON.parse(line);
  } catch {
    return Response.json(
      {
        error: "backend did not return JSON",
        code,
        stdoutTail: out.slice(-2000),
        logTail: err.slice(-4000),
      },
      { status: 500 },
    );
  }

  return Response.json({ ...result, code, logTail: err.slice(-6000) });
}
