"""Run bench-ception across the builder roster.

Full-nested HUD: each builder is the agent of `benchception.py`, and that env's
grader runs the probe on the builder's submitted environment. Phase 1 does no
training — the probe score just confirms each built env loads, runs, and grades.

    PYTHONPATH=. ~/.local/share/uv/tools/hud-python/bin/python \\
        -m environmentadi.run_benchception --include-golden
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
import warnings
from pathlib import Path

from .backends.hud import _quiet_teardown  # reuse the teardown-noise filter
from .config import BUILDERS, GOLDEN_AUTHOR, PROBE_MODEL, load_hud_key

ENV_PATH = str(Path(__file__).parent / "benchception.py")
warnings.filterwarnings("ignore", message=r".*add_tool\(\) is deprecated.*")


async def _score(builder: str) -> float:
    from hud.agents import create_agent
    from hud.eval import LocalRuntime, Taskset

    ts = Taskset.from_file(ENV_PATH)
    agent = create_agent(builder)
    job = await ts.run(agent, runtime=LocalRuntime(ENV_PATH), group=1, max_concurrent=1)
    rewards = [r.reward for r in job.runs if r.reward is not None]
    return sum(rewards) / len(rewards) if rewards else 0.0


async def _run(builders: list[str]) -> dict[str, float | None]:
    results: dict[str, float | None] = {}
    for b in builders:
        role = " (golden author)" if b == GOLDEN_AUTHOR else ""
        print(f"[bench-ception] {b}{role}: build env + probe-eval ...", flush=True)
        os.environ["BENCHCEPTION_BUILDER"] = b  # grader keys saved submission by this
        try:
            results[b] = await _score(b)
        except Exception as e:  # noqa: BLE001
            results[b] = None
            print(f"   ! {type(e).__name__}: {e}")
        print(f"   reward = {results[b]}", flush=True)
    return results


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="bench-ception: builders compete to build a HUD env")
    p.add_argument("--builders", default=None, help="comma-separated; default config.BUILDERS")
    p.add_argument("--include-golden", action="store_true",
                   help=f"also run the golden author ({GOLDEN_AUTHOR})")
    p.add_argument("--probe", default=None, help=f"probe model (default {PROBE_MODEL})")
    p.add_argument("--spec", default=None, help="path to a JSON spec file to feed builders")
    args = p.parse_args(argv)

    load_hud_key()
    if args.probe:
        os.environ["BENCHCEPTION_PROBE"] = args.probe  # benchception.py reads this
    if args.spec:
        os.environ["BENCHCEPTION_SPEC_FILE"] = str(Path(args.spec).resolve())
    builders = (args.builders.split(",") if args.builders else list(BUILDERS))
    if args.include_golden and GOLDEN_AUTHOR not in builders:
        builders.append(GOLDEN_AUTHOR)

    probe = args.probe or PROBE_MODEL
    print(f"probe={probe}  builders={builders}\n")

    loop = asyncio.new_event_loop()
    loop.set_exception_handler(_quiet_teardown)
    try:
        results = loop.run_until_complete(_run(builders))
    finally:
        loop.run_until_complete(asyncio.sleep(0.2))
        loop.close()

    print("\nBench-ception leaderboard (probe reward on each builder's env):")
    ranked = sorted(results.items(),
                    key=lambda kv: (kv[1] is not None, kv[1] or 0.0), reverse=True)
    for i, (b, s) in enumerate(ranked, 1):
        role = " (golden)" if b == GOLDEN_AUTHOR else ""
        shown = "FAIL" if s is None else f"{s:.3f}"
        print(f"{i}. {b:20}{role:9} {shown}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
