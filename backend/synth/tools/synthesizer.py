"""
The tool synthesizer (pipeline step 2).

`synthesize_tool` turns one v1 ToolBlock (name + English functionality) into a
SynthesizedTool (runnable Python + metadata + smoke result) using a two-tier strategy:

    1. template match  — reuse a hand-written, tested tool when the description fits.
    2. LLM codegen      — otherwise ask Claude to write it (if a key is configured).
    3. safe stub        — last resort so the pipeline always yields runnable output.

Every result is smoke-tested. Risky tools (code/network/fs) are compiled but never
executed here — that's deferred to HUD's sandbox.
"""

from __future__ import annotations

import ast

from synth.contracts import (
    ProjectSpec,
    SynthesizedTool,
    SynthesizedToolset,
    ToolBlock,
    ToolParam,
)
from typing import Any

from synth.tools.extract import extract_project
from synth.tools.llm import llm_synthesize_tool
from synth.tools.match import match_template
from synth.tools.smoke import compile_check, looks_risky


def ensure_docstring(source: str, description: str) -> str:
    """Guarantee the function has a docstring (FastMCP requires a tool description).

    Templates and stubs already include one; LLM codegen sometimes omits it, which makes
    `server.tool(fn)` reject the whole capability at runtime. If missing, inject the tool's
    description as the docstring; a no-op when one is already present.
    """
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return source
    fn = next((n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))), None)
    if fn is None or not fn.body or ast.get_docstring(fn) is not None:
        return source

    first = fn.body[0]
    doc = (description or fn.name).replace('"""', "'''").strip() or fn.name
    indent = " " * first.col_offset
    lines = source.splitlines()
    lines.insert(first.lineno - 1, f'{indent}"""{doc}"""')
    return "\n".join(lines) + ("\n" if source.endswith("\n") else "")


def synthesize_tool(block: ToolBlock, *, use_llm: bool = True) -> SynthesizedTool:
    tmpl = match_template(block.functionality)
    if tmpl is not None:
        tool = SynthesizedTool(
            name=block.name,
            description=tmpl.description,
            params=list(tmpl.params),
            source=tmpl.render(block.name),
            origin=f"template:{tmpl.key}",
            needs_sandbox=tmpl.needs_sandbox,
        )
        tool.smoke = compile_check(tool)
        return tool

    tool = llm_synthesize_tool(block) if use_llm else None
    if tool is not None:
        # FastMCP needs every tool to carry a description — guarantee a docstring.
        tool.source = ensure_docstring(tool.source, tool.description or block.functionality)
        # Trust-but-verify: if the source looks risky, force the sandbox gate on.
        tool.needs_sandbox = tool.needs_sandbox or looks_risky(tool.source)
        tool.smoke = compile_check(tool)
        return tool

    return _stub_tool(block)


def synthesize_toolset(spec: ProjectSpec, *, use_llm: bool = True) -> SynthesizedToolset:
    tools = [synthesize_tool(b, use_llm=use_llm) for b in spec.tools]
    origins = sorted({t.origin.split(":")[0] for t in tools})
    return SynthesizedToolset(
        env_name=spec.env.name,
        tools=tools,
        meta={"origins": origins, "count": len(tools)},
    )


def synthesize_from_json(raw: Any, *, use_llm: bool = True) -> SynthesizedToolset:
    """End-to-end: LLM-normalize arbitrary/versioned JSON, then synthesize the tools."""
    spec = extract_project(raw, use_llm=use_llm)
    return synthesize_toolset(spec, use_llm=use_llm)


_PY_TYPE = {"string": "str", "integer": "int", "number": "float", "boolean": "bool"}


def _stub_tool(block: ToolBlock) -> SynthesizedTool:
    """A safe no-op so an unmatched tool still produces runnable code.

    Honors any explicit params the (possibly custom) block declared, so richer schemas
    with extra arguments still yield a function with the right signature.
    """
    params = list(block.params) or [ToolParam(name="input", type="string", description="echoed input")]
    ordered = sorted(params, key=lambda p: not p.required)
    sig = ", ".join(
        f"{p.name}: {_PY_TYPE.get(p.type, 'str')}" + ("" if p.required else " | None = None")
        for p in ordered
    )
    ret = "{" + ", ".join(f"{p.name!r}: {p.name}" for p in ordered) + "}"
    desc = (block.functionality or "stub tool").replace('"""', "'''")
    source = (
        f"def {block.name}({sig}) -> str:\n"
        f'    """{desc} (STUB — not yet implemented)."""\n'
        f"    return str({ret})\n"
    )
    tool = SynthesizedTool(
        name=block.name,
        description=f"{block.functionality} (stub)",
        params=params,
        source=source,
        origin="stub",
        needs_sandbox=False,
    )
    tool.smoke = compile_check(tool)
    return tool
