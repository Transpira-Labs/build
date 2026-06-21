"""Tests for the tool synthesizer: template match, sandbox gating, assembly."""

from __future__ import annotations

from synth.contracts import ProjectSpec, ToolBlock
from synth.tools.assemble import assemble_module, emit_mcp_server
from synth.tools.extract import extract_project
from synth.tools.match import match_template
from synth.tools.synthesizer import (
    synthesize_from_json,
    synthesize_tool,
    synthesize_toolset,
)


def test_calculator_matches_template_and_runs_safely():
    tool = synthesize_tool(
        ToolBlock(name="calc", functionality="calculate an arithmetic expression"),
        use_llm=False,
    )
    assert tool.origin == "template:calculator"
    assert tool.needs_sandbox is False
    assert tool.smoke.status == "compiled"  # compile-only; tools are not executed here


def test_run_python_is_gated_to_sandbox():
    tool = synthesize_tool(
        ToolBlock(name="run_py", functionality="execute a python script and return stdout"),
        use_llm=False,
    )
    assert tool.origin == "template:run_python"
    assert tool.needs_sandbox is True
    # risky tools compile but are NOT executed locally
    assert tool.smoke.status == "compiled"
    assert "sandbox" in tool.smoke.detail.lower()


def test_http_and_search_match_distinct_templates():
    http = synthesize_tool(ToolBlock(name="get", functionality="fetch the contents of a url"), use_llm=False)
    search = synthesize_tool(ToolBlock(name="find", functionality="search the web for information"), use_llm=False)
    assert http.origin == "template:http_get"
    assert search.origin == "template:web_search"


def test_unmatched_without_llm_falls_back_to_stub():
    tool = synthesize_tool(
        ToolBlock(name="frobnicate", functionality="reticulate the splines somehow"),
        use_llm=False,
    )
    assert tool.origin == "stub"
    assert tool.smoke.status == "compiled"
    assert tool.needs_sandbox is False


def test_no_template_below_threshold():
    assert match_template("do something vague") is None


def test_synthesized_source_always_compiles():
    blocks = [
        ToolBlock(name="calc", functionality="evaluate a math expression"),
        ToolBlock(name="run_py", functionality="run a python script"),
        ToolBlock(name="weird", functionality="an undescribable thing"),
    ]
    spec = ProjectSpec(env={"name": "demo"}, tools=blocks)
    toolset = synthesize_toolset(spec, use_llm=False)
    for tool in toolset.tools:
        compile(tool.source, tool.name, "exec")


def test_assembled_module_imports_and_exposes_tools():
    spec = ProjectSpec(
        env={"name": "demo"},
        tools=[ToolBlock(name="calc", functionality="evaluate a math expression")],
    )
    toolset = synthesize_toolset(spec, use_llm=False)
    src = assemble_module(toolset)
    ns: dict = {}
    exec(compile(src, "tools.py", "exec"), ns)
    assert "TOOLS" in ns and len(ns["TOOLS"]) == 1
    assert ns["calc"]("2 + 3 * 4") == "14"


def test_extract_falls_back_to_heuristic_without_llm():
    raw = [
        {"type": "env", "name": "demo"},
        {"type": "tool", "name": "calc", "functionality": "evaluate a math expression"},
    ]
    spec = extract_project(raw, use_llm=False)
    assert isinstance(spec, ProjectSpec)
    assert spec.tools[0].name == "calc"


def test_synthesize_from_json_end_to_end_offline():
    raw = [
        {"type": "env", "name": "demo"},
        {"type": "tool", "name": "calc", "functionality": "evaluate a math expression"},
        {"type": "tool", "name": "run_py", "functionality": "run a python script"},
    ]
    toolset = synthesize_from_json(raw, use_llm=False)
    assert toolset.env_name == "demo"
    assert {t.name for t in toolset.tools} == {"calc", "run_py"}
    assert all(t.smoke.status in ("passed", "compiled") for t in toolset.tools)


def test_assembled_module_uses_v6_not_legacy_env_tool():
    spec = ProjectSpec(
        env={"name": "demo"},
        tools=[ToolBlock(name="calc", functionality="evaluate a math expression")],
    )
    src = assemble_module(synthesize_toolset(spec, use_llm=False))
    assert "env.tool(" not in src  # no legacy v5 call
    assert "mcp" in src.lower()    # points at the v6 capability path


def test_emit_mcp_server_is_v6_correct_and_compiles():
    spec = ProjectSpec(
        env={"name": "demo"},
        tools=[ToolBlock(name="calc", functionality="evaluate a math expression")],
    )
    toolset = synthesize_toolset(spec, use_llm=False)
    block = emit_mcp_server(toolset, capability_name="tools")

    compile(block, "mcp_wiring.py", "exec")  # syntactically valid
    # v6 shape: FastMCP server + mcp capability + lifecycle, registering TOOLS
    assert "FastMCP(name=\"demo_tools\")" in block
    assert "for _fn in TOOLS:" in block and "_tool_server.tool(_fn)" in block
    # ephemeral port: the URL is an f-string over the OS-assigned port, not a literal
    assert "_free_tcp_port()" in block
    assert 'Capability.mcp(name="tools", url=f"http://127.0.0.1:{_tool_port}/mcp")' in block
    assert "@env.initialize" in block and "@env.shutdown" in block
    assert "env.tool(" not in block  # never the legacy call

    # the whole env.py-ish concatenation parses together (with a tiny env stub)
    combined = assemble_module(toolset) + "\nenv = object()\n" + block
    compile(combined, "env.py", "exec")


def test_from_v1_flat_block_list():
    spec = ProjectSpec.from_v1(
        [
            {"type": "env", "name": "myenv"},
            {"type": "tool", "name": "calc", "functionality": "calculate math"},
            {"type": "task", "prompt": "what is 2+2", "answerType": "exact", "answer": "4"},
        ]
    )
    assert spec.env.name == "myenv"
    assert spec.tools[0].name == "calc"
    assert spec.tasks[0].answer_type == "exact"


def test_ensure_docstring_injects_when_missing():
    from synth.tools.synthesizer import ensure_docstring
    src = "def read_file(file_path: str) -> str:\n    with open(file_path) as f:\n        return f.read()\n"
    fixed = ensure_docstring(src, "Read a text file and return its contents.")
    import ast as _ast
    fn = _ast.parse(fixed).body[0]
    assert _ast.get_docstring(fn) == "Read a text file and return its contents."
    compile(fixed, "t", "exec")


def test_ensure_docstring_noop_when_present():
    from synth.tools.synthesizer import ensure_docstring
    src = 'def f(x: str) -> str:\n    """already documented."""\n    return x\n'
    assert ensure_docstring(src, "other") == src
