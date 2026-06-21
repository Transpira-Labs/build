"""
Contracts for the tasks synthesizer (pipeline step 3).

Mirrors the tool synthesizer's shape: a `ProjectSpec` comes in (already normalized
from arbitrary/versioned JSON by the shared LLM extractor), and a
`SynthesizedTaskset` of `SynthesizedScenario`s comes out — each a runnable
`@env.template()` plus how it was made and whether its grader was verified.

Grading regime is the key idea. It is the LLM's (or, offline, the answer_type's)
decision, captured in `grading_mode`:

    "deterministic" → a normalized comparison against a literal golden answer
                      (cheap, unhackable, golden-gate-verifiable).
    "llm_judge"     → an LLM judge scores the agent's outcome against a rubric
                      (for open-ended success the user only described).

`ScenarioPlan` is the *decision* (made by the LLM or the deterministic fallback);
the grader code is then rendered canonically from it, never freehanded by the model
— the reward is the whole RL signal and must stay correct.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from synth.contracts import SmokeResult, TaskBlock

GradingMode = Literal["deterministic", "llm_judge"]

#: how each authored answer_type maps to a grading regime (the offline default)
GRADING_MODE: dict[str, GradingMode] = {
    "exact": "deterministic",
    "state": "llm_judge",
}


def grading_mode(task: TaskBlock) -> GradingMode:
    return GRADING_MODE[task.answer_type]


class Diagnostic(BaseModel):
    level: Literal["error", "warn", "info"]
    code: str
    message: str
    task_id: str | None = None


class ScenarioPlan(BaseModel):
    """The grading decision for one task — the LLM's job, or derived from answer_type.

    The grader is rendered canonically from these fields; the model never writes
    reward code directly.
    """

    prompt: str = Field(description="the (possibly refined) prompt handed to the agent")
    mode: GradingMode
    # deterministic:
    expected: str | None = Field(default=None, description="literal golden answer to compare against")
    match: Literal["auto", "numeric", "text"] = "auto"
    # llm_judge:
    criteria: list[str] = Field(default_factory=list, description="rubric the judge scores against")


class SynthesizedScenario(BaseModel):
    """One synthesized task template plus provenance, smoke result, and concrete calls.

    A parameterized template mints several concrete tasks, so `calls` is a list (one
    `fn(arg=...)` per parameter combination; just `fn()` when unparameterized).
    """

    id: str
    fn_name: str
    prompt: str
    grading_mode: GradingMode
    source: str = Field(description="the decorated `@env.template()` async generator (no imports)")
    imports: list[str] = Field(default_factory=list, description="import lines the grader needs")
    calls: list[str] = Field(default_factory=list, description="concrete task calls for the Taskset")
    origin: str = Field(description="'llm' | 'deterministic' | 'stub'")
    smoke: SmokeResult = Field(default_factory=SmokeResult)
    diagnostics: list[Diagnostic] = Field(default_factory=list)


class SynthesizedTaskset(BaseModel):
    """The tasks synthesizer's full output for one project (handoff to step 4)."""

    env_name: str
    scenarios: list[SynthesizedScenario] = Field(default_factory=list)
    meta: dict = Field(default_factory=dict)
    diagnostics: list[Diagnostic] = Field(default_factory=list)

    @property
    def imports(self) -> list[str]:
        """Union of every scenario's imports, plus Taskset, in stable order."""
        seen: list[str] = []
        for s in self.scenarios:
            for imp in s.imports:
                if imp not in seen:
                    seen.append(imp)
        if self.scenarios and "from hud import Taskset" not in seen:
            seen.append("from hud import Taskset")
        return seen

    @property
    def task_count(self) -> int:
        """Number of concrete tasks (parameter expansion counted)."""
        return sum(len(s.calls or [s.fn_name]) for s in self.scenarios)

    @property
    def all_diagnostics(self) -> list[Diagnostic]:
        out = list(self.diagnostics)
        for s in self.scenarios:
            out.extend(s.diagnostics)
        return out

    @property
    def has_errors(self) -> bool:
        return any(d.level == "error" for d in self.all_diagnostics) or any(
            s.smoke.status == "failed" for s in self.scenarios
        )

    def render(self) -> str:
        """The task half of env.py: imports + every @env.template() + the Taskset."""
        blocks: list[str] = []
        if self.imports:
            blocks.append("\n".join(self.imports))
        blocks.extend(s.source for s in self.scenarios)
        all_calls = [c for s in self.scenarios for c in (s.calls or [f"{s.fn_name}()"])]
        if all_calls:
            calls = "\n".join(f"    {c}," for c in all_calls)
            blocks.append(f'tasks = Taskset("{self.env_name}", [\n{calls}\n])')
        else:
            blocks.append("tasks = []")
        return "\n\n".join(blocks).rstrip() + "\n"
