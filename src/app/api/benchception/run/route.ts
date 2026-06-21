// bench-ception bridge — kicks off an EnvironmentAdi run over the environments
// the user built. Additive: nothing else in the app imports or depends on this.
//
// The browser POSTs the IR specs (toIR output) it already has in localStorage;
// we drop them into EnvironmentAdi/inbox/ and spawn the Python orchestrator,
// which runs bench-ception and writes a status file the /status route polls.
//
// Local-only by design: this spawns a subprocess, so it works under
// `npm run dev` (Node server), not on a static/serverless deploy.

import { spawn } from "node:child_process";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs"; // needs Node APIs (child_process / fs)

const ENVADI_DIR = path.join(process.cwd(), "EnvironmentAdi");
const INBOX = path.join(ENVADI_DIR, "inbox");
const STATUS = path.join(ENVADI_DIR, "dashboard", "run_status.json");
// The interpreter that has hud-python + openai installed.
const PYTHON =
  process.env.BENCHCEPTION_PYTHON ||
  path.join(
    process.env.HOME || "",
    ".local/share/uv/tools/hud-python/bin/python",
  );

type IncomingSpec = { id?: string; project?: { id?: string; name?: string } };

export async function POST(req: Request) {
  let body: { specs?: IncomingSpec[]; threshold?: number; buildAttempts?: number; group?: number };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const specs = body.specs ?? [];
  if (!Array.isArray(specs) || specs.length === 0) {
    return Response.json({ error: "no specs provided" }, { status: 400 });
  }
  const threshold = body.threshold ?? specs.length;

  // Refresh the inbox to exactly the current set of environments.
  await mkdir(INBOX, { recursive: true });
  for (const f of await readdir(INBOX).catch(() => [])) {
    if (f.endsWith(".json")) await rm(path.join(INBOX, f));
  }
  let i = 0;
  for (const spec of specs) {
    const id = spec.project?.id || spec.id || `env_${i}`;
    const safe = String(id).replace(/[^a-zA-Z0-9_-]/g, "_");
    await writeFile(path.join(INBOX, `${safe}.json`), JSON.stringify(spec, null, 2));
    i++;
  }

  // Fire-and-forget the orchestrator; it writes run_status.json as it goes.
  const child = spawn(
    PYTHON,
    [
      "-m", "environmentadi.orchestrate",
      "--inbox", "inbox",
      "--threshold", String(threshold),
      "--status-file", "dashboard/run_status.json",
      "--build-attempts", String(body.buildAttempts ?? 3),
      "--group", String(body.group ?? 1),
    ],
    { cwd: ENVADI_DIR, env: { ...process.env, PYTHONPATH: "." }, detached: true, stdio: "ignore" },
  );
  child.unref();

  return Response.json({
    ok: true,
    enqueued: specs.length,
    threshold,
    statusFile: path.relative(process.cwd(), STATUS),
  });
}
