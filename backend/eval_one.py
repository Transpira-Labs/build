"""
Bridge for the web app: baseline-eval the project's env and print the leaderboard
as JSON. Reads a request object from **stdin**:

    {"blocks": [...v1 blocks...], "models": ["claude-haiku-4-5"], "group": 3}
    {"taskset": "name-or-path.py", ...}   # alternative source

With `blocks`, it compiles the env to a local `env.py` (offline) and evals that
file — the env runs locally (LocalRuntime) while the agent/model is routed
through HUD. (Running the *deployed* HUD taskset would need `Taskset.from_api`,
which requires the taskset to be registered on the platform.) Runs
`synth.eval.baseline.run_baseline` and prints ONE JSON object to **stdout** — the
leaderboard to_dict() plus `ok`. HUD SDK stdout (progress) is redirected to
**stderr** so stdout stays clean JSON for the Next.js `/api/eval` route.

Real runs cost HUD compute and need HUD_API_KEY (the caller passes it through).
`--dry-run` returns the plan without running.
"""

from __future__ import annotations

import argparse
import contextlib
import json
import sys
import tempfile
import traceback
from pathlib import Path


def _source_from_request(req: dict) -> tuple[str | None, str | None]:
    """Resolve the eval source. Returns (source, error)."""
    blocks = req.get("blocks")
    taskset = (req.get("taskset") or "").strip()

    if blocks:
        from synth.compile.registry import build_from_project
        from synth.tools.extract import extract_project

        # use_llm=True so the eval env has the SAME (real) tools as the deployed
        # one — otherwise custom tools compile to stubs and the eval is meaningless.
        spec = extract_project(blocks, use_llm=True)
        cb = build_from_project(blocks, spec, use_llm=True)
        if not cb.deployable:
            return None, "the env did not compile — fix the project first"
        out = Path(tempfile.mkdtemp(prefix="syntheval-"))
        for rel, content in cb.files.items():
            p = out / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(content)
        return str(out / "env.py"), None

    if taskset:
        return taskset, None
    return None, "blocks or taskset required"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="eval_one")
    ap.add_argument("--dry-run", action="store_true", help="return the plan without running")
    args = ap.parse_args(argv)

    try:
        req = json.loads(sys.stdin.read())
    except json.JSONDecodeError as e:
        print(json.dumps({"ok": False, "error": f"invalid JSON on stdin: {e}"}))
        return 1

    models = req.get("models") or None
    try:
        group = int(req.get("group") or 3)
    except (TypeError, ValueError):
        group = 3

    from synth.compile.deploy import has_api_key
    from synth.eval.baseline import BaselinePlan, run_baseline

    source, err = _source_from_request(req)
    if err:
        print(json.dumps({"ok": False, "error": err}))
        return 1
    assert source is not None

    if args.dry_run:
        plan = run_baseline(source, models, group=group, dry_run=True)
        assert isinstance(plan, BaselinePlan)
        print(json.dumps({"ok": True, "dry_run": True, "source": source,
                          "models": plan.models, "group": plan.group}))
        return 0

    if not has_api_key():
        print(json.dumps({"ok": False, "error": "no HUD_API_KEY in the environment"}))
        return 1

    real_stdout = sys.stdout
    try:
        # Keep stdout clean: the HUD SDK may print progress; send it to stderr.
        with contextlib.redirect_stdout(sys.stderr):
            lb = run_baseline(source, models, group=group)
    except Exception as e:  # noqa: BLE001 - surface any failure as JSON
        traceback.print_exc(file=sys.stderr)
        print(json.dumps({"ok": False, "error": str(e)}), file=real_stdout)
        return 1

    assert not isinstance(lb, BaselinePlan)
    out = lb.to_dict()
    out["ok"] = True
    print(json.dumps(out), file=real_stdout)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
