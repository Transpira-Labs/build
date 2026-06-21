"""
Backward-compatible step-4 entry points, on top of the contribution/IR spine.

`assemble_env` / `compile_env` keep the convenient `(toolset, taskset)` signature for the
two-handoff case, but internally they just build contributions and run `build_codebase`.
New block types go through `synth.compile.contributors` + `build_codebase` directly.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from synth.compile.contributors import task_contributions, tool_contributions
from synth.compile.ir import Codebase, build_codebase
from synth.contracts import SynthesizedToolset
from synth.tasks.spec import Diagnostic, SynthesizedTaskset


@dataclass
class CompiledEnv:
    """The result of step 4: the env.py source, its pinned version, and diagnostics."""

    source: str
    version: str
    env_name: str
    diagnostics: list[Diagnostic] = field(default_factory=list)
    ok: bool = True


def build_env_codebase(
    toolset: SynthesizedToolset,
    taskset: SynthesizedTaskset,
    *,
    description: str = "",
    version: str | None = None,
    capability_name: str = "tools",
) -> Codebase:
    """The full deployable project for the tools+tasks case (env.py today; +deps/files later)."""
    contributions = (
        tool_contributions(toolset, capability_name=capability_name)
        + task_contributions(taskset)
    )
    env_name = toolset.env_name or taskset.env_name or "env"
    return build_codebase(contributions, env_name=env_name, description=description, version=version)


def assemble_env(
    toolset: SynthesizedToolset,
    taskset: SynthesizedTaskset,
    *,
    description: str = "",
    version: str | None = None,
    capability_name: str = "tools",
) -> str:
    """Render just the env.py source string."""
    return build_env_codebase(
        toolset, taskset, description=description, version=version, capability_name=capability_name
    ).env_py


def compile_env(
    toolset: SynthesizedToolset,
    taskset: SynthesizedTaskset,
    *,
    description: str = "",
    version: str | None = None,
    capability_name: str = "tools",
) -> CompiledEnv:
    """Assemble env.py and compile-check it (syntax only)."""
    cb = build_env_codebase(
        toolset, taskset, description=description, version=version, capability_name=capability_name
    )
    return CompiledEnv(
        source=cb.env_py, version=cb.ir.version, env_name=cb.ir.env_name,
        diagnostics=cb.diagnostics, ok=cb.ok,
    )
