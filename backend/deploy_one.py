"""
Bridge for the web app: compile a v1 project JSON into a HUD env and (optionally)
deploy it. Reads the v1 JSON from **stdin**, runs extract → build → (deploy), and
prints exactly ONE JSON object to **stdout**.

`hud deploy` build logs are streamed to **stderr** so stdout stays clean JSON the
Next.js `/api/deploy` route can parse. Invoked locally (dev) via the backend venv:

    echo '<v1-json>' | .venv/bin/python deploy_one.py            # compile + deploy
    echo '<v1-json>' | .venv/bin/python deploy_one.py --dry-run  # compile, print cmd, don't deploy
    echo '<v1-json>' | .venv/bin/python deploy_one.py --no-llm   # offline (no gateway calls)

Needs HUD_API_KEY in the environment for a real deploy (the caller passes it through).
"""

from __future__ import annotations

import argparse
import ast
import json
import subprocess
import sys
import tempfile
from pathlib import Path


def _tool_report(env_py: Path, tool_names: list[str]) -> list[dict]:
    """Classify each tool in the generated env.py as implemented or a stub.

    The synthesizer marks unimplemented tools with '(STUB — not yet implemented)'
    in the docstring and a body that just echoes its input. We read this from the
    *generated* code, so the report is exactly what gets deployed."""
    docs: dict[str, str] = {}
    try:
        tree = ast.parse(env_py.read_text())
        for n in ast.walk(tree):
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
                docs[n.name] = ast.get_docstring(n) or ""
    except Exception:  # noqa: BLE001 - best effort; absence means "unknown"
        pass

    report: list[dict] = []
    for name in tool_names:
        doc = docs.get(name, "")
        is_stub = "stub" in doc.lower() and "not yet implemented" in doc.lower()
        report.append({"name": name, "implemented": not is_stub})
    return report


def _taskset_rows(env_name: str, taskset_calls: list[str]) -> list[dict]:
    """Compiled task call exprs → portable taskset rows, without importing env.py.

    Each call looks like ``template_id(arg=literal, ...)``; we read the template
    id and its literal kwargs straight from the AST. Returns
    ``[{"env", "id", "args"}, ...]`` — the shape `Taskset.from_file(.jsonl)` loads
    and `hud sync tasks` uploads."""
    rows: list[dict] = []
    for call in taskset_calls:
        try:
            expr = ast.parse(call, mode="eval").body
        except SyntaxError:
            continue
        if not isinstance(expr, ast.Call) or not isinstance(expr.func, ast.Name):
            continue
        args: dict = {}
        ok = True
        for kw in expr.keywords:
            if not kw.arg:
                continue
            try:
                args[kw.arg] = ast.literal_eval(kw.value)
            except (ValueError, SyntaxError):
                ok = False
                break
        if ok:
            rows.append({"env": env_name, "id": expr.func.id, "args": args})
    return rows


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="deploy_one")
    ap.add_argument("--no-llm", action="store_true", help="skip the LLM extractor/codegen (offline)")
    ap.add_argument("--dry-run", action="store_true", help="compile + print the deploy command, don't run it")
    args = ap.parse_args(argv)

    try:
        raw = json.loads(sys.stdin.read())
    except json.JSONDecodeError as e:
        print(json.dumps({"deployed": False, "message": f"invalid JSON on stdin: {e}"}))
        return 1

    from synth.compile.deploy import _hud_executable, build_deploy_command, has_api_key
    from synth.compile.registry import build_from_project
    from synth.tools.extract import extract_project

    use_llm = not args.no_llm
    spec = extract_project(raw, use_llm=use_llm)
    cb = build_from_project(raw, spec, use_llm=use_llm)

    out = Path(tempfile.mkdtemp(prefix="synth-"))
    for rel, content in cb.files.items():
        p = out / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content)

    tools = _tool_report(out / "env.py", [t.name for t in spec.tools])
    stubbed = [t["name"] for t in tools if not t["implemented"]]

    result: dict = {
        "env_name": cb.ir.env_name,
        "version": cb.ir.version,
        "compiled": bool(cb.ok),
        "deployable": bool(cb.deployable),
        "tools": tools,
        "stubbed": stubbed,
        "diagnostics": [
            {"level": d.level, "code": d.code, "message": d.message} for d in cb.diagnostics
        ],
        "out_dir": str(out),
        "deployed": False,
        "message": "",
    }

    if not cb.deployable:
        result["message"] = "not deployable — fix the errors above first"
        print(json.dumps(result))
        return 1

    hud = _hud_executable()
    if hud is None:
        result["message"] = "the `hud` CLI is not installed (pip install hud-python)"
        print(json.dumps(result))
        return 1

    cmd = build_deploy_command(out, hud=hud)
    result["command"] = cmd

    if args.dry_run:
        result["message"] = "dry run — command not executed"
        print(json.dumps(result))
        return 0

    if not has_api_key():
        result["message"] = "no HUD_API_KEY in the environment"
        print(json.dumps(result))
        return 1

    # Inherit nothing to stdout: build logs go to stderr so our JSON line is the
    # only thing on stdout.
    proc = subprocess.run(cmd, stdout=sys.stderr, stderr=sys.stderr)
    if proc.returncode != 0:
        result["deployed"] = False
        result["message"] = f"`hud deploy` exited with code {proc.returncode}"
        print(json.dumps(result))
        return 1

    result["deployed"] = True
    result["message"] = "deployed"

    # `hud deploy` registers the env image but NOT its taskset, so sync it.
    #
    # We sync from a portable JSONL we build straight from the compiled IR — one
    # row per task: {env, id (the @env.template id), args}. Syncing from env.py
    # would make `hud` IMPORT it locally (and every tool dependency); for envs
    # whose synthesized tools pull in packages this backend's venv doesn't have,
    # that import fails and 0 tasks are collected — the "taskset didn't sync"
    # case. The JSONL needs nothing but `hud`. The platform resolves (env, id)
    # against the env's freshly-deployed build manifest and validates args.
    # See https://docs.hud.ai/v6/core/tasks (".json/.jsonl portable rows").
    result["taskset"] = cb.ir.env_name
    rows = _taskset_rows(cb.ir.env_name, cb.ir.taskset_calls)
    if not rows:
        result["taskset_synced"] = False
        result["taskset_error"] = "no task rows compiled from the project — add at least one Task"
        result["message"] = "deployed, but there are no tasks to sync"
        print(json.dumps(result))
        return 0

    tasks_jsonl = out / "tasks.jsonl"
    tasks_jsonl.write_text("\n".join(json.dumps(r) for r in rows) + "\n")

    # `--yes` is deprecated; `hud sync tasks` no longer prompts. Run it
    # non-interactively (DEVNULL stdin) so a stray confirmation can't block us.
    sync_cmd = [hud, "sync", "tasks", cb.ir.env_name, str(tasks_jsonl)]
    sync_proc = subprocess.run(sync_cmd, stdin=subprocess.DEVNULL, capture_output=True, text=True)
    sync_out = (sync_proc.stdout or "") + (sync_proc.stderr or "")
    sys.stderr.write(sync_out)  # keep the full sync log on stderr (Railway logs / logTail)
    # Treat "collected 0 tasks" as a failure too — `hud sync` can exit 0 having uploaded nothing.
    found_zero = "Found 0 task" in sync_out or "No Task objects found" in sync_out
    result["taskset_synced"] = sync_proc.returncode == 0 and not found_zero
    if result["taskset_synced"]:
        result["message"] = f"deployed and synced {len(rows)} task(s)"
    else:
        tail = [ln for ln in sync_out.splitlines() if ln.strip()][-8:]
        result["taskset_error"] = "\n".join(tail) or f"`hud sync tasks` exited {sync_proc.returncode}"
        result["message"] = "deployed, but TASKSET SYNC FAILED — the run page won't find tasks (see taskset_error)"
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    from bridge_log import run
    run("deploy_one", main)
