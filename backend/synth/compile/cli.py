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

from synth.compile.registry import build_from_project
from synth.tools.extract import extract_project


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="synth-env", description="Compile a HUD v6 project from a project JSON.")
    ap.add_argument("project", help="path to the UI's project JSON (any version)")
    ap.add_argument("-o", "--out", default="out", help="output directory (default: out/)")
    ap.add_argument("--no-llm", action="store_true", help="skip LLM extraction/codegen/planning (offline)")
    ap.add_argument("--version", default=None, help="override the pinned env version (default: content hash)")
    args = ap.parse_args(argv)

    use_llm = not args.no_llm
    raw = json.loads(Path(args.project).read_text())

    spec = extract_project(raw, use_llm=use_llm)
    cb = build_from_project(raw, spec, use_llm=use_llm, version=args.version)

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    for relpath, content in cb.files.items():
        (out / relpath).write_text(content)

    files = ", ".join(sorted(cb.files))
    print(f"[compile] {cb.ir.env_name} v{cb.ir.version}: "
          f"{len(cb.ir.defines)} defs, {len(cb.ir.taskset_calls)} tasks → {out}/ ({files})")
    print(f"[compile] compiled {'✓' if cb.ok else '✗'}  deployable {'✓' if cb.deployable else '✗'}")
    for d in cb.diagnostics:
        print(f"  [{d.level}] {d.code}: {d.message}")
    return 0 if cb.deployable else 1


if __name__ == "__main__":
    raise SystemExit(main())
