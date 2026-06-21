"""
CLI: run a baseline evaluation over a task source (pipeline step 6).

    synth-eval out/env.py                          # default models, local env.py
    synth-eval out/env.py --models claude-haiku-4-5,gpt-5 --group 8
    synth-eval "My Taskset" --group 8              # a deployed platform taskset (runs on HUD)
    synth-eval out/env.py --dry-run                # print the plan, run nothing

A `.py` source runs locally (the env serves itself); a bare name is a deployed taskset and
runs on HUD. Real runs need a HUD_API_KEY and cost compute, so the run is explicit. Writes a
leaderboard JSON (the step-8 registry handoff) with `-o`.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from synth.eval.baseline import DEFAULT_MODELS, BaselinePlan, render_leaderboard, run_baseline


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="synth-eval", description="Baseline-eval a task source across models.")
    ap.add_argument("source", help="task source: a .py file (local) or a deployed taskset name (HUD)")
    ap.add_argument("--models", default=",".join(DEFAULT_MODELS),
                    help="comma-separated model ids (default: a spanning weak→strong set)")
    ap.add_argument("--group", type=int, default=4, help="rollouts per task (reward spread)")
    ap.add_argument("--max-concurrent", type=int, default=10, help="cap parallel rollouts")
    ap.add_argument("--dry-run", action="store_true", help="print the plan without running")
    ap.add_argument("-o", "--out", default=None, help="write the leaderboard JSON here")
    args = ap.parse_args(argv)

    models = [m.strip() for m in args.models.split(",") if m.strip()]

    if not args.dry_run:
        from synth.compile.deploy import has_api_key

        if not has_api_key():
            print("[baseline] no HUD_API_KEY found — run `hud set HUD_API_KEY=...` (or pass --dry-run).")
            return 1

    result = run_baseline(args.source, models, group=args.group,
                          max_concurrent=args.max_concurrent, dry_run=args.dry_run)

    if isinstance(result, BaselinePlan):
        print(f"[baseline] DRY RUN — would run {len(result.models)} model(s) × group {result.group} "
              f"over {result.source}:")
        for m in result.models:
            print(f"    • {m}")
        return 0

    print(render_leaderboard(result))
    for d in result.diagnostics:
        print(f"  [{d.level}] {d.code}: {d.message}")
    if args.out:
        Path(args.out).write_text(json.dumps(result.to_dict(), indent=2))
        print(f"[baseline] wrote {args.out}")

    return 1 if result.has_errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
