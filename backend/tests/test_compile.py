"""Tests for the step-4 compiler: tools + tasks → one v6 env.py that compiles."""

from __future__ import annotations

from synth.compile import (
    EnvContribution,
    assemble_env,
    build_codebase,
    compile_env,
    task_contributions,
    tool_contributions,
)
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


# ── the contribution/IR spine: forward-compat for new block types ───────────
def test_novel_contribution_lands_without_touching_the_renderer():
    """A future block type (here: a stand-in 'resource') plugs in as a contribution and
    reaches every slot — proving step 4 is total over slots, not over input types."""
    spec = _spec()
    toolset = synthesize_toolset(spec, use_llm=False)

    resource = EnvContribution(
        source="resource:orders_db",
        imports=["import sqlite3"],
        pre_env=["def _seed_db():\n    pass"],
        post_env=["@env.initialize\nasync def _start_db():\n    _seed_db()"],
        taskset_calls=[],
        py_deps=["aiosqlite"],
        system_deps=["sqlite3"],
        files={"fixtures/seed.sql": "CREATE TABLE orders(id INTEGER);"},
        defines=["_seed_db"],
    )

    cb = build_codebase(tool_contributions(toolset) + [resource], env_name="research_agent")
    assert cb.ok
    # the new contribution reached the source and the file set, with no renderer changes
    assert "def _seed_db():" in cb.env_py and "_start_db" in cb.env_py
    assert cb.files["fixtures/seed.sql"].startswith("CREATE TABLE orders")
    # deps were collected into the IR, ready for pyproject/Dockerfile (step 2)
    assert "aiosqlite" in cb.ir.py_deps and "sqlite3" in cb.ir.system_deps
    assert "fastmcp" in cb.ir.py_deps  # tools contributed theirs too


def test_conflicting_files_are_an_error_not_a_crash():
    a = EnvContribution(source="a", files={"data.txt": "one"})
    b = EnvContribution(source="b", files={"data.txt": "two"})
    cb = build_codebase([a, b], env_name="e")
    assert not cb.ok
    assert any(d.code == "build.file_conflict" and d.level == "error" for d in cb.diagnostics)


# ── the contributor registry: the open slot for new block types ─────────────
def test_registry_has_builtin_contributors():
    from synth.compile import registered
    reg = registered()
    assert "tools" in reg and "tasks" in reg


def test_build_from_project_runs_registered_contributors():
    from synth.compile import build_from_project
    spec = _spec()
    cb = build_from_project(spec.model_dump(), spec, use_llm=False)
    assert cb.ok
    assert "env = Environment(" in cb.env_py and "tasks = Taskset(" in cb.env_py


def test_new_block_plugs_in_via_register_only():
    """Registering one contributor makes a new block land in env.py — no other change."""
    from synth.compile import EnvContribution, build_from_project, register, unregister

    register(
        "storage_demo",
        lambda ctx: [EnvContribution(source="storage_demo", post_env=["# storage wiring here"])],
        block_types=("storage",),
    )
    try:
        spec = _spec()
        cb = build_from_project(spec.model_dump(), spec, use_llm=False)
        assert "# storage wiring here" in cb.env_py
    finally:
        unregister("storage_demo")


def test_unhandled_block_type_is_flagged_not_dropped():
    from synth.compile import build_from_project
    spec = _spec()
    raw = [{"type": "env", "name": "research_agent"}, {"type": "storage", "name": "db"}]
    cb = build_from_project(raw, spec, use_llm=False)
    assert any(d.code == "block.unhandled" and "storage" in d.message for d in cb.diagnostics)


def test_failing_contributor_degrades_to_diagnostic():
    from synth.compile import build_from_project, register, unregister

    def _boom(ctx):
        raise RuntimeError("kaboom")

    register("boom", _boom)
    try:
        spec = _spec()
        cb = build_from_project(spec.model_dump(), spec, use_llm=False)
        assert any(d.code == "contributor.failed" and "kaboom" in d.message for d in cb.diagnostics)
        assert "env = Environment(" in cb.env_py  # build still produced the env
    finally:
        unregister("boom")


# ── step 2: project files (pyproject / Dockerfile) + deployability gate ──────
def test_emits_pyproject_and_dockerfile():
    spec = _spec()
    cb = build_codebase(tool_contributions(synthesize_toolset(spec, use_llm=False)), env_name="research_agent")
    assert cb.deployable
    pyproject = cb.files["pyproject.toml"]
    assert 'name = "research_agent"' in pyproject
    assert '"hud-python>=0.6"' in pyproject and '"fastmcp>=2.0"' in pyproject

    dockerfile = cb.files["Dockerfile.hud"]
    assert "FROM python:3.12-slim" in dockerfile
    assert 'CMD ["hud", "serve", "env.py", "--host", "0.0.0.0", "--port", "8765"]' in dockerfile


def test_system_deps_become_apt_install():
    resource = EnvContribution(source="resource", system_deps=["postgresql-client"], py_deps=["asyncpg"])
    cb = build_codebase([resource], env_name="e")
    assert "apt-get install -y --no-install-recommends" in cb.files["Dockerfile.hud"]
    assert "postgresql-client" in cb.files["Dockerfile.hud"]
    assert '"asyncpg"' in cb.files["pyproject.toml"]


def test_undeclared_dependency_blocks_deploy():
    # a contribution that imports a third-party package without declaring it
    bad = EnvContribution(
        source="rogue_tool",
        imports=["import requests"],
        pre_env=["def fetch(u: str) -> str:\n    return requests.get(u).text"],
        defines=["fetch"],
        # note: no py_deps=["requests"]
    )
    cb = build_codebase([bad], env_name="e")
    assert cb.ok            # it compiles fine
    assert not cb.deployable  # but it won't deploy
    assert any(d.code == "deploy.undeclared_dependency" and "requests" in d.message for d in cb.diagnostics)


def test_declaring_the_dependency_makes_it_deployable():
    good = EnvContribution(
        source="ok_tool",
        imports=["import requests"],
        pre_env=["def fetch(u: str) -> str:\n    return requests.get(u).text"],
        py_deps=["requests"],
        defines=["fetch"],
    )
    cb = build_codebase([good], env_name="e")
    assert cb.deployable
    assert '"requests"' in cb.files["pyproject.toml"]


def test_no_capability_is_warned():
    spec = ProjectSpec(env=EnvBlock(name="qa"), tools=[],
                       tasks=[TaskBlock(prompt="What is 2+2?", answerType="exact", answer="4")])
    _, taskset = _build(spec)
    cb = build_codebase(task_contributions(taskset), env_name="qa")
    assert any(d.code == "deploy.no_capability" for d in cb.diagnostics)
    assert cb.deployable  # a warning, not a blocker
