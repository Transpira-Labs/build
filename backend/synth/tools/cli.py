"""
CLI: synthesize runnable tools from a v1 project (or tools-only) JSON.

    synth-tools project.json -o out/      # writes out/toolset.json + out/tools.py
    synth-tools project.json --no-llm     # force template-match + safe-stub only

Input is *any* version of the UI's JSON: an LLM normalizes it into a canonical
ProjectSpec (schema-agnostic), then the tools are synthesized. Output is the normalized
project (json), the SynthesizedToolset (json), and an assembled, importable tools.py.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from synth.tools.assemble import assemble_module
from synth.tools.extract import extract_project
from synth.tools.synthesizer import synthesize_toolset

_SMOKE_ICON = {"passed": "✓", "compiled": "≈", "failed": "✗", "skipped": "·"}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="synth-tools", description="Synthesize runnable tools from v1 JSON.")
    ap.add_argument("project", help="path to the UI's project JSON (any version)")
    ap.add_argument("-o", "--out", default="out", help="output directory (default: out/)")
    ap.add_argument("--no-llm", action="store_true",
                    help="skip LLM extraction/codegen (heuristic parse + templates + stubs)")
    args = ap.parse_args(argv)

    raw = json.loads(Path(args.project).read_text())
    spec = extract_project(raw, use_llm=not args.no_llm)
    toolset = synthesize_toolset(spec, use_llm=not args.no_llm)

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "project.json").write_text(spec.model_dump_json(indent=2))
    (out / "toolset.json").write_text(toolset.model_dump_json(indent=2))
    (out / "tools.py").write_text(assemble_module(toolset))

    print(f"[tool-synth] {toolset.env_name}: {len(toolset.tools)} tools")
    for t in toolset.tools:
        icon = _SMOKE_ICON.get(t.smoke.status, "?")
        sandbox = " [sandbox]" if t.needs_sandbox else ""
        params = ", ".join(p.name for p in t.params)
        print(f"  {icon} {t.name}({params})  <{t.origin}>{sandbox} — {t.smoke.status}: {t.smoke.detail}")
    print(f"[tool-synth] wrote {out/'project.json'}, {out/'toolset.json'}, {out/'tools.py'}")

    failed = [t.name for t in toolset.tools if t.smoke.status == "failed"]
    if failed:
        print(f"[tool-synth] WARNING: smoke failed for {failed}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
