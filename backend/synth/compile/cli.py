"""
CLI: compile a runnable HUD v6 `env.py` from a project JSON (pipeline step 4).

    synth-env project.json -o out/      # writes out/env.py (compile-checked)
    synth-env project.json --no-llm     # offline: heuristic parse + templates + deterministic graders

Input is *any* version of the UI's JSON. The shared LLM extractor normalizes it, the tool
and task synthesizers run, and their two handoffs are stitched into one env.py — which is
then **compile-checked** (syntax only; no boot, no eval). Exit code is non-zero if the
env.py fails to compile or an error-level diagnostic is raised.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from synth.compile.assemble_env import compile_env
from synth.tasks.synthesizer import synthesize_taskset
from synth.tools.extract import extract_project
from synth.tools.synthesizer import synthesize_toolset


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="synth-env", description="Compile a HUD v6 env.py from a project JSON.")
    ap.add_argument("project", help="path to the UI's project JSON (any version)")
    ap.add_argument("-o", "--out", default="out", help="output directory (default: out/)")
    ap.add_argument("--no-llm", action="store_true", help="skip LLM extraction/codegen/planning (offline)")
    ap.add_argument("--version", default=None, help="override the pinned env version (default: content hash)")
    args = ap.parse_args(argv)

    use_llm = not args.no_llm
    raw = json.loads(Path(args.project).read_text())

    spec = extract_project(raw, use_llm=use_llm)
    toolset = synthesize_toolset(spec, use_llm=use_llm)
    taskset = synthesize_taskset(
        raw, env_name=spec.env.name, tool_names={t.name for t in spec.tools}, use_llm=use_llm,
    )
    result = compile_env(toolset, taskset, description=spec.env.description, version=args.version)

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    env_path = out / "env.py"
    env_path.write_text(result.source)

    print(f"[compile] {result.env_name} v{result.version}: "
          f"{len(toolset.tools)} tools, {taskset.task_count} tasks → {env_path}")
    print(f"[compile] {'compiled ✓' if result.ok else 'FAILED ✗'}")
    for d in result.diagnostics:
        print(f"  [{d.level}] {d.code}: {d.message}")
    return 0 if result.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
