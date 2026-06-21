"""
Bridge: (re)sync a project's taskset to HUD WITHOUT a full rebuild/redeploy.

Reads `{"blocks": [...v1...], "env_name": "optional override"}` from **stdin**,
compiles the project OFFLINE (no LLM, no `hud deploy`) just to recover the env
name and the concrete task rows — a task's identity (`@env.template` id + args)
is deterministic; the LLM only shapes grading, which the portable JSONL rows
don't carry — writes a `tasks.jsonl`, and runs `hud sync tasks <env_name>
tasks.jsonl`. Prints ONE JSON line:

    {"ok": bool, "taskset": "<env>", "taskset_synced": bool, "count": N,
     "taskset_error": "..."}    # taskset_error only on failure

Use when `hud deploy` already succeeded but the taskset sync didn't (a transient
upload error, a since-fixed CLI flag) — far cheaper than rebuilding the image.
Needs HUD_API_KEY (HUD_API_URL is dropped upstream so the SDK uses the beta
backend the env deployed to).
"""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path


def main() -> int:
    try:
        req = json.loads(sys.stdin.read())
    except json.JSONDecodeError as e:
        print(json.dumps({"ok": False, "error": f"invalid JSON on stdin: {e}"}))
        return 1

    blocks = req.get("blocks")
    if not isinstance(blocks, list) or not blocks:
        print(json.dumps({"ok": False, "error": "blocks[] required"}))
        return 1
    override = (req.get("env_name") or "").strip()

    from deploy_one import _taskset_rows
    from hud.cli.utils.source import normalize_environment_name
    from synth.compile.deploy import _hud_executable, has_api_key
    from synth.compile.registry import build_from_project
    from synth.tools.extract import extract_project

    if not has_api_key():
        print(json.dumps({"ok": False, "error": "no HUD_API_KEY in the environment"}))
        return 1
    hud = _hud_executable()
    if hud is None:
        print(json.dumps({"ok": False, "error": "the `hud` CLI is not installed"}))
        return 1

    # Offline compile — task identity (id + args) doesn't depend on the LLM, so
    # we skip it (and the deploy) entirely and just rebuild the rows.
    spec = extract_project(blocks, use_llm=False)
    cb = build_from_project(blocks, spec, use_llm=False)
    # Match HUD's registered (slugified) env name — task rows reference the env by
    # this name, and so does the taskset we create/update.
    env_name = normalize_environment_name(override or cb.ir.env_name)
    rows = _taskset_rows(env_name, cb.ir.taskset_calls)
    if not rows:
        print(json.dumps({"ok": False, "taskset": env_name, "taskset_synced": False,
                          "error": "no task rows compiled — add at least one Task"}))
        return 1

    out = Path(tempfile.mkdtemp(prefix="synthresync-"))
    tasks_jsonl = out / "tasks.jsonl"
    tasks_jsonl.write_text("\n".join(json.dumps(r) for r in rows) + "\n")

    # PTY-driven so the confirm prompt doesn't crash; success is read from the
    # output (the CLI exits 0 even when the upload fails). See hud_cli.
    from hud_cli import run_sync, sync_succeeded

    sync_cmd = [hud, "sync", "tasks", env_name, str(tasks_jsonl)]
    _rc, sync_out = run_sync(sync_cmd)
    sys.stderr.write(sync_out)  # full log to stderr (Railway / logTail)

    ok = sync_succeeded(sync_out)
    result: dict = {"ok": ok, "taskset": env_name, "taskset_synced": ok, "count": len(rows)}
    if not ok:
        tail = [ln for ln in sync_out.splitlines() if ln.strip()][-8:]
        result["taskset_error"] = "\n".join(tail) or "`hud sync tasks` did not report success"
    print(json.dumps(result))
    return 0 if ok else 1


if __name__ == "__main__":
    from bridge_log import run

    run("sync_tasks", main)
