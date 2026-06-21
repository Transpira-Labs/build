"""
Contribution producers — turn each synthesizer's output into `EnvContribution`s.

These are the only place that knows about a specific handoff type (`SynthesizedToolset`,
`SynthesizedTaskset`). They translate it into slot contributions; the IR reducer/renderer
stays type-agnostic. A new block type (resources, capabilities, …) adds a producer here
and changes nothing downstream.
"""

from __future__ import annotations

from synth.compile.ir import EnvContribution
from synth.contracts import SynthesizedToolset
from synth.tasks.spec import Diagnostic, SynthesizedTaskset
from synth.tools.assemble import _split_imports, mcp_capability_parts


def tool_contributions(
    toolset: SynthesizedToolset, *, capability_name: str = "tools"
) -> list[EnvContribution]:
    """Tools → an `mcp` capability: tool defs + a `TOOLS` list (pre_env) and the FastMCP
    serve/teardown lifecycle (post_env, references `env`)."""
    if not toolset.tools:
        return []

    imports: list[str] = []
    defs: list[str] = []
    diagnostics: list[Diagnostic] = []
    for tool in toolset.tools:
        tool_imports, body = _split_imports(tool.source)
        for imp in tool_imports:
            if imp not in imports:
                imports.append(imp)
        defs.append(body)
        if tool.smoke.status == "failed":
            diagnostics.append(Diagnostic(
                level="error", code="tool.smoke_failed",
                message=f"Tool {tool.name!r} did not compile: {tool.smoke.detail}",
            ))

    mcp_imports, mcp_body = mcp_capability_parts(toolset, capability_name=capability_name)
    for imp in mcp_imports:
        if imp not in imports:
            imports.append(imp)

    tools_list = f"TOOLS = [{', '.join(t.name for t in toolset.tools)}]"
    # The shared WORLD seed must be defined BEFORE the tool defs that read it.
    pre_env = [toolset.world] if toolset.world else []
    pre_env += ["\n\n".join(defs), tools_list]
    defines = (["WORLD"] if toolset.world else []) + [t.name for t in toolset.tools]
    return [EnvContribution(
        source="tools",
        imports=imports,
        pre_env=pre_env,
        post_env=[mcp_body],
        py_deps=["fastmcp"],
        defines=defines,
        diagnostics=diagnostics,
    )]


def task_contributions(taskset: SynthesizedTaskset) -> list[EnvContribution]:
    """Tasks → `@env.template()` defs (post_env) + the concrete rows for the Taskset."""
    diagnostics = list(taskset.all_diagnostics)
    if not taskset.scenarios:
        return [EnvContribution(source="tasks", diagnostics=diagnostics)]

    templates = "\n\n".join(s.source for s in taskset.scenarios)
    calls = [c for s in taskset.scenarios for c in (s.calls or [f"{s.fn_name}()"])]
    return [EnvContribution(
        source="tasks",
        imports=list(taskset.imports),  # grader imports + `from hud import Taskset`
        post_env=[templates],
        taskset_calls=calls,
        defines=[s.fn_name for s in taskset.scenarios],
        diagnostics=diagnostics,
    )]
