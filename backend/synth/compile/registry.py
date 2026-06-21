"""
Contributor registry — the open extension point for new block types.

Each block family registers a contributor keyed by name; `build_from_project` runs every
registered contributor over the project and feeds their contributions to the step-4 reducer.
Adding a new block type ("storage", "secret", …) is one `register(...)` call — the build
loop, the reducer, and the renderer never change.

Two robustness guarantees for a front-end that's actively adding blocks:
  • A contributor that raises is caught and turned into an error diagnostic — a half-built
    or experimental block type can never crash the pipeline.
  • A block type present in the input but handled by no contributor is surfaced as a
    diagnostic, never silently dropped.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

from synth.compile.contributors import task_contributions, tool_contributions
from synth.compile.ir import Codebase, EnvContribution, build_codebase
from synth.contracts import ProjectSpec
from synth.tasks.spec import Diagnostic
from synth.tasks.synthesizer import synthesize_taskset
from synth.tools.synthesizer import synthesize_toolset


@dataclass
class BuildContext:
    """Everything a contributor might need from the project, in one place."""

    raw: Any  # the original project JSON (schema-agnostic)
    spec: ProjectSpec  # the normalized spec
    use_llm: bool = True
    version: str | None = None

    @property
    def env_name(self) -> str:
        return self.spec.env.name or "env"

    @property
    def description(self) -> str:
        return self.spec.env.description

    @property
    def tool_names(self) -> set[str]:
        return {t.name for t in self.spec.tools}


ContributorFn = Callable[[BuildContext], list[EnvContribution]]


@dataclass
class _Entry:
    fn: ContributorFn
    block_types: frozenset[str]


_REGISTRY: dict[str, _Entry] = {}
_ENV_TYPES = {"env", "environment"}


def register(name: str, fn: ContributorFn | None = None, *, block_types: tuple[str, ...] = ()):
    """Register a contributor for a block family. Usable as a decorator or a direct call.

    `block_types` lists the raw block `type` strings this contributor consumes; it's used to
    detect input blocks that no contributor handles.
    """
    def _apply(f: ContributorFn) -> ContributorFn:
        _REGISTRY[name] = _Entry(fn=f, block_types=frozenset(bt.lower() for bt in block_types))
        return f

    return _apply(fn) if fn is not None else _apply


def unregister(name: str) -> None:
    """Remove a contributor (no-op if absent)."""
    _REGISTRY.pop(name, None)


def registered() -> dict[str, ContributorFn]:
    """The registered contributors, keyed by name (for inspection/tests)."""
    return {name: entry.fn for name, entry in _REGISTRY.items()}


def _handled_block_types() -> set[str]:
    handled: set[str] = set()
    for entry in _REGISTRY.values():
        handled |= entry.block_types
    return handled


def collect_contributions(ctx: BuildContext) -> list[EnvContribution]:
    """Run every registered contributor; one that raises degrades to an error diagnostic."""
    out: list[EnvContribution] = []
    for name, entry in _REGISTRY.items():
        try:
            out.extend(entry.fn(ctx) or [])
        except Exception as exc:  # noqa: BLE001 - one bad contributor must not sink the build
            out.append(EnvContribution(source=name, diagnostics=[Diagnostic(
                level="error", code="contributor.failed",
                message=f"Contributor {name!r} raised: {exc!r}; skipped.",
            )]))
    return out


def _present_block_types(raw: Any) -> set[str]:
    """Best-effort scan of the raw JSON for block `type` strings (any input shape)."""
    items: list[Any] = []
    if isinstance(raw, dict):
        items += raw.get("blocks") or raw.get("nodes") or []
        for key in ("env", "tools", "tasks", "custom", "resources"):
            value = raw.get(key)
            if isinstance(value, list):
                items += value
            elif isinstance(value, dict):
                items.append(value)
    elif isinstance(raw, list):
        items = raw
    return {
        str(b["type"]).lower()
        for b in items
        if isinstance(b, dict) and b.get("type")
    }


def build_from_project(
    raw: Any, spec: ProjectSpec, *, use_llm: bool = True, version: str | None = None
) -> Codebase:
    """Run all registered contributors over the project and assemble the deployable codebase."""
    ctx = BuildContext(raw=raw, spec=spec, use_llm=use_llm, version=version)
    contributions = collect_contributions(ctx)

    unhandled = _present_block_types(raw) - _handled_block_types() - _ENV_TYPES
    unhandled_diags = [Diagnostic(
        level="info", code="block.unhandled",
        message=f"Block type {kind!r} has no contributor; it was not added to the environment.",
    ) for kind in sorted(unhandled)]

    cb = build_codebase(contributions, env_name=ctx.env_name, description=ctx.description, version=ctx.version)
    cb.diagnostics = unhandled_diags + cb.diagnostics
    return cb


# ── built-in contributors ────────────────────────────────────────────────────
@register("tools", block_types=("tool",))
def _tools_contributor(ctx: BuildContext) -> list[EnvContribution]:
    toolset = synthesize_toolset(ctx.spec, use_llm=ctx.use_llm)
    return tool_contributions(toolset)


@register("tasks", block_types=("task",))
def _tasks_contributor(ctx: BuildContext) -> list[EnvContribution]:
    taskset = synthesize_taskset(
        ctx.raw, env_name=ctx.env_name, tool_names=ctx.tool_names, use_llm=ctx.use_llm
    )
    return task_contributions(taskset)
