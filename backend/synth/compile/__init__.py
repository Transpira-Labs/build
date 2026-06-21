"""Pipeline step 4 (compile): merge synthesizer outputs into a deployable HUD v6 project.

Each synthesizer emits `EnvContribution`s targeting a finite set of build slots; the IR
reducer merges them and the renderer produces the project files (env.py today; pyproject /
Dockerfile next). New block types plug in as new contributors — the reducer/renderer never
changes. Per the current scope this step compile-checks only (no boot, no eval).
"""

from synth.compile.assemble_env import CompiledEnv, assemble_env, build_env_codebase, compile_env
from synth.compile.contributors import task_contributions, tool_contributions
from synth.compile.ir import (
    BuildIR,
    Codebase,
    EnvContribution,
    build_codebase,
    deployability_gate,
    project_dependencies,
    reduce_contributions,
    render_dockerfile,
    render_env_py,
    render_pyproject,
)
from synth.compile.registry import (
    BuildContext,
    build_from_project,
    collect_contributions,
    register,
    registered,
    unregister,
)

__all__ = [
    "CompiledEnv",
    "assemble_env",
    "build_env_codebase",
    "compile_env",
    "tool_contributions",
    "task_contributions",
    "BuildIR",
    "Codebase",
    "EnvContribution",
    "build_codebase",
    "reduce_contributions",
    "render_env_py",
    "render_pyproject",
    "render_dockerfile",
    "deployability_gate",
    "project_dependencies",
    "BuildContext",
    "build_from_project",
    "collect_contributions",
    "register",
    "registered",
    "unregister",
]
