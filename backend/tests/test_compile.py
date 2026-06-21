"""Tests for the step-4 compiler: tools + tasks → one v6 env.py that compiles."""

from __future__ import annotations

from synth.compile import assemble_env, compile_env
from synth.contracts import EnvBlock, ProjectSpec, TaskBlock, ToolBlock
from synth.tasks.synthesizer import synthesize_taskset
from synth.tools.synthesizer import synthesize_toolset


def _spec():
    return ProjectSpec(
        env=EnvBlock(name="research_agent", description="An agent that computes and looks things up."),
        tools=[
            ToolBlock(name="calculator", functionality="evaluate an arithmetic expression"),
            ToolBlock(name="run_python", functionality="execute a python script and return stdout"),
        ],
        tasks=[
            TaskBlock(prompt="What is 17 * 23?", answerType="exact", answer="391"),
            TaskBlock(prompt="Find the population of France.", answerType="state",
                      answer="States the approximate population of France."),
        ],
    )


def _build(spec):
    toolset = synthesize_toolset(spec, use_llm=False)
    taskset = synthesize_taskset(spec, env_name=spec.env.name,
                                 tool_names={t.name for t in spec.tools}, use_llm=False)
    return toolset, taskset


def test_env_compiles_and_is_v6():
    spec = _spec()
    result = compile_env(*_build(spec), description=spec.env.description)
    assert result.ok
    src = result.source
    compile(src, "env.py", "exec")  # the whole module is valid python

    # v6 shape, no v5 idioms
    assert "env = Environment(name=\"research_agent\"" in src
    assert "Capability.mcp(" in src and "@env.initialize" in src and "@env.shutdown" in src
    assert "@env.template(id=" in src and "tasks = Taskset(" in src
    assert "env.tool(" not in src and "@env.scenario" not in src and "add_tool" not in src


def test_description_becomes_module_docstring():
    spec = _spec()
    src = assemble_env(*_build(spec), description=spec.env.description)
    # the env description leads the module docstring (provenance), not a prompt
    assert src.startswith('"""An agent that computes and looks things up.')
    assert "version:" in src and "Serve with `hud serve env.py`" in src


def test_version_is_pinned_and_reproducible():
    spec = _spec()
    a = compile_env(*_build(spec))
    b = compile_env(*_build(spec))
    assert a.version == b.version  # content hash → reproducible
    assert a.version.startswith("0.1.0+")
    assert f'version="{a.version}"' in a.source


def test_imports_are_hoisted_and_coalesced():
    spec = _spec()
    src = assemble_env(*_build(spec))
    # both graders end up on a single coalesced import line
    assert "from hud.graders import LLMJudgeGrader, numeric_match" in src
    # exactly one import block (no stray mid-file `from hud.graders` lines)
    assert src.count("from hud.graders import") == 1


def test_name_collision_is_an_error():
    # a tool and a task that slug to the same function name must be flagged
    spec = ProjectSpec(
        env=EnvBlock(name="e"),
        tools=[ToolBlock(name="lookup", functionality="evaluate an arithmetic expression")],
        tasks=[TaskBlock(prompt="lookup", answerType="exact", answer="1")],
    )
    result = compile_env(*_build(spec))
    assert any(d.code == "env.name_collision" and d.level == "error" for d in result.diagnostics)
    assert result.ok is False


def test_no_tools_still_compiles_without_capability_block():
    spec = ProjectSpec(
        env=EnvBlock(name="qa"),
        tools=[],
        tasks=[TaskBlock(prompt="What is 2+2?", answerType="exact", answer="4")],
    )
    result = compile_env(*_build(spec))
    assert result.ok
    assert "FastMCP" not in result.source and "Capability.mcp" not in result.source
    assert "tasks = Taskset(" in result.source
