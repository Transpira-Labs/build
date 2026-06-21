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
from synth.tools.gateway import preflight_llm


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="synth-env", description="Compile a HUD v6 project from a project JSON.")
    ap.add_argument("project", help="path to the UI's project JSON (any version)")
    ap.add_argument("-o", "--out", default="out", help="output directory (default: out/)")
    ap.add_argument("--no-llm", action="store_true", help="skip LLM extraction/codegen/planning (offline)")
    ap.add_argument("--version", default=None, help="override the pinned env version (default: content hash)")
    ap.add_argument("--deploy", action="store_true", help="after compiling, deploy to HUD (`hud deploy`)")
    ap.add_argument("--deploy-dry-run", action="store_true",
                    help="print the `hud deploy` command without running it")
    args = ap.parse_args(argv)

    use_llm = preflight_llm(use_llm=not args.no_llm, context="synth-env")
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

    if args.deploy or args.deploy_dry_run:
        return _deploy(out, cb, dry_run=args.deploy_dry_run)
    return 0 if cb.deployable else 1


def _deploy(out, cb, *, dry_run: bool) -> int:
    from synth.compile.deploy import deploy_codebase, has_api_key

    if not cb.deployable:
        print("[deploy] refusing — codebase is not deployable; fix the errors above first.")
        return 1
    if not dry_run and not has_api_key():
        print("[deploy] no HUD_API_KEY found — run `hud set HUD_API_KEY=...` (or pass --deploy-dry-run).")
        return 1

    result = deploy_codebase(out, env_name=cb.ir.env_name, dry_run=dry_run)
    if result.command:
        print("[deploy] $ " + " ".join(result.command))
    print(f"[deploy] {result.message}")
    return 0 if result.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
