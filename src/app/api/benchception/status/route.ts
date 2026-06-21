// Polled by the bench-ception runner page. Returns the orchestrator's status
// file verbatim (waiting / running / done / error), or {state:"idle"} if no run
// has happened yet. Additive; reads only.

import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // never cache; the file changes per run

const STATUS = path.join(process.cwd(), "EnvironmentAdi", "dashboard", "run_status.json");

export async function GET() {
  try {
    const raw = await readFile(STATUS, "utf8");
    return Response.json(JSON.parse(raw));
  } catch {
    return Response.json({ state: "idle" });
  }
}
