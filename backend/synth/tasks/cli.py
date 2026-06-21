"""
CLI: synthesize verified HUD tasks from a v1 project (or tasks-only) JSON.

    python -m synth.tasks.cli project.json -o out/   # writes out/taskset.json + out/tasks.py
    python -m synth.tasks.cli project.json --no-llm   # deterministic planning (offline)

Input is *any* version of the UI's JSON: the shared LLM extractor normalizes it into a
canonical ProjectSpec, then each task is synthesized (LLM-first, deterministic fallback)
and smoke-checked. Output is the SynthesizedTaskset (json) and the assembled task half
of env.py (tasks.py), to be concatenated with the tool capability block at compile time.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from synth.tools.extract import extract_project
from synth.tools.gateway import preflight_llm
from synth.tasks.synthesizer import synthesize_taskset

_ICON = {"passed": "✓", "compiled": "≈", "failed": "✗", "skipped": "·"}

_HEADER = (
    '"""AUTO-GENERATED tasks for env {env!r} (RL Scratch tasks synthesizer).\n\n'
    "The task half of env.py — concatenate with the tool capability block at compile.\n"
    'Register nothing; `tasks` is a Taskset ready to run.\n"""\n'
)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="synth-tasks", description="Synthesize verified HUD tasks from v1 JSON.")
    ap.add_argument("project", help="path to the UI's project JSON (any version)")
    ap.add_argument("-o", "--out", default="out", help="output directory (default: out/)")
    ap.add_argument("--no-llm", action="store_true", help="skip LLM planning (deterministic from answer_type)")
    ap.add_argument("--judge-model", default=None, help="override the judge model for llm_judge tasks")
    args = ap.parse_args(argv)

    use_llm = preflight_llm(use_llm=not args.no_llm, context="synth-tasks")
    raw = json.loads(Path(args.project).read_text())
    spec = extract_project(raw, use_llm=use_llm)
    kwargs = {"judge_model": args.judge_model} if args.judge_model else {}
    taskset = synthesize_taskset(spec, use_llm=use_llm, **kwargs)

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "taskset.json").write_text(taskset.model_dump_json(indent=2))
    (out / "tasks.py").write_text(_HEADER.format(env=taskset.env_name) + "\n" + taskset.render())

    print(f"[task-synth] {taskset.env_name}: {len(taskset.scenarios)} tasks")
    for s in taskset.scenarios:
        icon = _ICON.get(s.smoke.status, "?")
        print(f"  {icon} {s.fn_name}()  <{s.origin}/{s.grading_mode}> — {s.smoke.status}: {s.smoke.detail}")
    for d in taskset.all_diagnostics:
        print(f"  [{d.level}] {d.code}: {d.message}")
    print(f"[task-synth] wrote {out/'taskset.json'} and {out/'tasks.py'}")
    return 1 if taskset.has_errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
