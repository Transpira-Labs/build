"""
Bridge for the web app: run a managed-RL training loop on the project's tasks
through HUD and print the reward curve as JSON. Reads a request object from
**stdin**:

    {"blocks": [...v1 blocks...], "base": "qwen3-8b", "steps": 10, "group": 8}
    {"taskset": "name-or-path.py", "model": "my-rl", ...}   # alternative source

With `blocks`, it compiles the env to a local `env.py` (offline, with the SAME
real tools as the deployed env) and trains on that file (LocalRuntime), exactly
like `eval_one.py`. The model is sampled AND trained through HUD's managed
trainer, so inference is routed through HUD either way.

Training needs a *trainable* model slug. By default we fork `base` (an
open-weight model like qwen3-8b) into a per-env slug first via
`hud models fork`; a pre-existing slug is fine — we keep training on it. Pass a
step-6 `baseline` leaderboard (from `eval_one.py`) to gate on reward spread and
to read the curve against the baseline ceiling.

Runs `synth.train.loop.run_training` and prints ONE JSON object to **stdout**
(the TrainingResult to_dict() plus `ok` and the run params). HUD SDK progress is
redirected to **stderr** so stdout stays clean JSON for the `/api/train` route.

Real runs cost HUD compute and need HUD_API_KEY (the caller passes it through).
`--dry-run` returns the plan without running.
"""

from __future__ import annotations

import argparse
import contextlib
import json
import re
import sys
import tempfile
import traceback
from pathlib import Path


def _slugify(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")
    return s or "env"


def _source_from_request(req: dict) -> tuple[str | None, str | None]:
    """Resolve the training source. Returns (source, error). Mirrors eval_one."""
    blocks = req.get("blocks")
    taskset = (req.get("taskset") or "").strip()

    if blocks:
        from synth.compile.registry import build_from_project
        from synth.tools.extract import extract_project

        # use_llm=True so the trained env has the SAME (real) tools as the
        # deployed one — otherwise custom tools compile to stubs and the
        # rollouts carry no signal to learn from.
        spec = extract_project(blocks, use_llm=True)
        cb = build_from_project(blocks, spec, use_llm=True)
        if not cb.deployable:
            return None, "the env did not compile — fix the project first"
        out = Path(tempfile.mkdtemp(prefix="synthtrain-"))
        for rel, content in cb.files.items():
            p = out / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(content)
        return str(out / "env.py"), None

    if taskset:
        return taskset, None
    return None, "blocks or taskset required"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="train_one")
    ap.add_argument("--dry-run", action="store_true", help="return the plan without running")
    args = ap.parse_args(argv)

    try:
        req = json.loads(sys.stdin.read())
    except json.JSONDecodeError as e:
        print(json.dumps({"ok": False, "error": f"invalid JSON on stdin: {e}"}))
        return 1

    base = (req.get("base") or "qwen3-8b").strip()
    env_name = (req.get("name") or req.get("env_name") or "").strip()
    model_slug = (req.get("model") or "").strip() or f"{_slugify(env_name) or _slugify(base)}-rl"
    try:
        steps = max(1, int(req.get("steps") or 10))
    except (TypeError, ValueError):
        steps = 10
    try:
        group = max(1, int(req.get("group") or 8))
    except (TypeError, ValueError):
        group = 8
    mode = "expert_iteration" if req.get("mode") == "expert_iteration" else "grpo"
    baseline = req.get("baseline") if isinstance(req.get("baseline"), dict) else None
    do_fork = req.get("fork", True)

    from synth.train.loop import TrainConfig, TrainPlan, fork_model, run_training

    source, err = _source_from_request(req)
    if err:
        print(json.dumps({"ok": False, "error": err}))
        return 1
    assert source is not None

    config = TrainConfig(model_slug=model_slug, steps=steps, group=group, mode=mode)

    if args.dry_run:
        plan = run_training(config, source, baseline=baseline, dry_run=True)
        assert isinstance(plan, TrainPlan)
        print(json.dumps({"ok": True, "dry_run": True, "source": source,
                          "model_slug": model_slug, "base": base,
                          "steps": steps, "group": group, "mode": mode}))
        return 0

    from synth.compile.deploy import has_api_key

    if not has_api_key():
        print(json.dumps({"ok": False, "error": "no HUD_API_KEY in the environment"}))
        return 1

    real_stdout = sys.stdout
    fork_msg: str | None = None
    try:
        # Keep stdout clean: the hud CLI/SDK may print progress; send it to stderr.
        with contextlib.redirect_stdout(sys.stderr):
            if do_fork:
                # Mint the trainable slug. If it already exists from a prior run,
                # `hud models fork` exits non-zero — that's fine, we train on it.
                fork = fork_model(base, model_slug)
                fork_msg = fork.message
            result = run_training(config, source, baseline=baseline)
    except Exception as e:  # noqa: BLE001 - surface any failure as JSON
        traceback.print_exc(file=sys.stderr)
        print(json.dumps({"ok": False, "error": str(e)}), file=real_stdout)
        return 1

    assert not isinstance(result, TrainPlan)
    out = result.to_dict()
    out["ok"] = result.ok
    out["source"] = source
    out["base"] = base
    out["steps"] = steps
    out["group"] = group
    out["mode"] = mode
    if fork_msg:
        out["fork"] = fork_msg
    print(json.dumps(out), file=real_stdout)
    return 0 if result.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
