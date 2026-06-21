"""Instrumented bench-ception run that records EVERYTHING for the dashboard.

For every spec ("prompt") × every builder it captures: the build system prompt,
the spec handed over, the builder's generated environment, validity, and every
probe rollout's full trace (task setup, agent turns, tool calls, final answer) +
reward + a link to the hosted hud.ai trace.

It runs the same logical pipeline as `benchception.py` (build → probe-eval) but
unrolled in-process so the build output and the probe trace are both visible.
Writes `dashboard/data.js` (a `window.BENCHCEPTION_DATA = {...}` assignment so
the dashboard opens straight from disk, no server needed).

    PYTHONPATH=. ~/.local/share/uv/tools/hud-python/bin/python \\
        -m environmentadi.capture --specs specs/supchain_bench.json specs/letter_count.json
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import tempfile
import warnings
from pathlib import Path

from .backends.hud import _quiet_teardown
from .benchception import BUILD_INSTRUCTIONS, _strip_fences
from .config import BUILDERS, GATEWAY_URL, GOLDEN_AUTHOR, PROBE_MODEL, load_hud_key

warnings.filterwarnings("ignore", message=r".*add_tool\(\) is deprecated.*")
HUD_TRACE_URL = "https://hud.ai/trace/"
DASH = Path(__file__).parent.parent / "dashboard"


def _role(model: str) -> str:
    return "golden author" if model == GOLDEN_AUTHOR else "builder"


def _build(spec_text: str, model: str, key: str) -> tuple[str, str, str]:
    """Builder writes an env. Returns (system_prompt, user_prompt, code)."""
    from openai import OpenAI

    client = OpenAI(base_url=GATEWAY_URL, api_key=key)
    resp = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": BUILD_INSTRUCTIONS},
            {"role": "user", "content": spec_text},
        ],
        max_tokens=8192,  # headroom so a long env is never cut off
    )
    return BUILD_INSTRUCTIONS, spec_text, _strip_fences(resp.choices[0].message.content or "")


async def _probe(env_path: str, probe_model: str, group: int) -> tuple[int, list[dict]]:
    from hud.agents import create_agent
    from hud.eval import LocalRuntime, Taskset

    ts = Taskset.from_file(env_path)
    n = len(ts)
    job = await ts.run(
        create_agent(probe_model),
        runtime=LocalRuntime(env_path),
        group=group,
        max_concurrent=group,
    )
    rollouts = []
    for r in job.runs:
        tr = r.trace.model_dump() if getattr(r, "trace", None) else {}
        tid = getattr(r, "trace_id", None)
        rollouts.append(
            {
                "reward": r.reward,
                "status": tr.get("status"),
                "trace_id": tid,
                "trace_url": (HUD_TRACE_URL + tid) if tid else None,
                "final_answer": tr.get("content"),
                "steps": tr.get("steps") or [],
            }
        )
    return n, rollouts


async def _attempt(spec_text: str, model: str, key: str, probe: str, group: int, idx: int) -> dict:
    """One build attempt: build -> validate -> probe-eval. Returns an attempt record."""
    att = {"idx": idx}
    try:
        _sys, _user, code = await asyncio.to_thread(_build, spec_text, model, key)
        att["code"] = code
    except Exception as e:  # noqa: BLE001
        return {**att, "code": "", "valid": False, "n_tasks": 0, "score": 0.0,
                "rollouts": [], "error": f"build failed: {type(e).__name__}: {e}"}

    d = Path(tempfile.mkdtemp(prefix="capture_"))
    (d / "env.py").write_text(code)
    try:
        n, rollouts = await _probe(str(d / "env.py"), probe, group)
        rewards = [r["reward"] for r in rollouts if r["reward"] is not None]
        return {**att, "valid": True, "n_tasks": n, "rollouts": rollouts,
                "score": (sum(rewards) / len(rewards) if rewards else 0.0)}
    except Exception as e:  # noqa: BLE001
        return {**att, "valid": False, "n_tasks": 0, "rollouts": [], "score": 0.0,
                "error": f"{type(e).__name__}: {e}"}


async def _capture(spec_files: list[Path], builders: list[str], probe: str, group: int,
                   key: str, generated_at: str, attempts: int) -> dict:
    specs_out = []
    for sf in spec_files:
        spec_text = sf.read_text()
        try:
            spec_json = json.loads(spec_text)
            name = spec_json.get("project", {}).get("name") or spec_json.get("name") or sf.stem
        except Exception:
            spec_json, name = None, sf.stem
        print(f"\n=== spec: {name} ({sf.name}) ===", flush=True)

        builders_out = []
        for model in builders:
            print(f"  [{model}] {attempts} build attempt(s):", flush=True)
            atts = []
            for a in range(attempts):
                att = await _attempt(spec_text, model, key, probe, group, a + 1)
                atts.append(att)
                tag = att.get("error") or f"{att['n_tasks']} task(s) · {att['score']:.2f}"
                print(f"    #{a+1}: {tag[:60]}", flush=True)
            scores = [a["score"] for a in atts]
            builders_out.append({
                "model": model, "role": _role(model),
                "system_prompt": BUILD_INSTRUCTIONS, "user_prompt": spec_text,
                "n_attempts": len(atts),
                "valid_count": sum(1 for a in atts if a.get("valid")),
                "score_best": max(scores) if scores else 0.0,
                "score_mean": (sum(scores) / len(scores)) if scores else 0.0,
                "attempts": atts,
            })

        specs_out.append({"id": sf.stem, "name": name, "file": sf.name,
                          "spec_text": spec_text, "spec_json": spec_json,
                          "builders": builders_out})

    return {
        "meta": {
            "generated_at": generated_at, "gateway": GATEWAY_URL, "probe": probe,
            "group": group, "build_attempts": attempts,
            "golden_author": GOLDEN_AUTHOR, "builders": builders,
            "note": "Instrumented capture of build -> probe-eval, with build sampling.",
        },
        "specs": specs_out,
    }


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="capture bench-ception runs for the dashboard")
    p.add_argument("--specs", nargs="+",
                   default=["specs/supchain_bench.json", "specs/letter_count.json"])
    p.add_argument("--probe", default=PROBE_MODEL)
    p.add_argument("--group", type=int, default=2, help="probe rollouts per attempt")
    p.add_argument("--build-attempts", type=int, default=3, help="build samples per builder")
    p.add_argument("--include-golden", action="store_true", default=True)
    p.add_argument("--no-golden", dest="include_golden", action="store_false")
    p.add_argument("--generated-at", default="", help="timestamp string for the run")
    args = p.parse_args(argv)

    key = load_hud_key()
    builders = list(BUILDERS) + ([GOLDEN_AUTHOR] if args.include_golden else [])
    spec_files = [Path(s) for s in args.specs]
    for sf in spec_files:
        if not sf.exists():
            print(f"spec not found: {sf}", file=sys.stderr)
            return 1

    print(f"capture: {len(spec_files)} spec(s) x {len(builders)} builder(s) "
          f"x {args.build_attempts} attempt(s) · probe={args.probe} · group={args.group}")

    loop = asyncio.new_event_loop()
    loop.set_exception_handler(_quiet_teardown)
    try:
        data = loop.run_until_complete(
            _capture(spec_files, builders, args.probe, args.group, key,
                     args.generated_at, args.build_attempts))
    finally:
        loop.run_until_complete(asyncio.sleep(0.2))
        loop.close()

    DASH.mkdir(parents=True, exist_ok=True)
    (DASH / "data.js").write_text("window.BENCHCEPTION_DATA = "
                                  + json.dumps(data, default=str, indent=2) + ";\n")
    print(f"\nwrote {DASH/'data.js'}  ({(DASH/'data.js').stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
