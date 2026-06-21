"""
Baseline evaluation (pipeline step 6).

Run each benchmark model as the agent across every task, collect per-task rewards, and
aggregate into a leaderboard. This does triple duty (per the HUD task-design doctrine):
it proves the env is **solvable** (not everyone scores 0) and **discriminating** (not
everyone scores 1), sets the **ceiling** a trained model will chase, and flags any task
where every strong model fails — a tell the answer or grader is off.

Two layers, mirroring the deploy step:
  • `aggregate` / `Leaderboard` — pure reward-matrix math + verdicts, fully offline-testable.
  • `run_baseline` — the runner that drives HUD (`create_agent` + `taskset.run`). It needs a
    `HUD_API_KEY`, costs real compute, and is only invoked explicitly; `dry_run=True`
    returns the plan without executing.
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from synth.tasks.spec import Diagnostic

_EPS = 1e-6
_FLOOR = 0.0  # a task is "solved" when a model's mean reward is strictly above this


@dataclass
class TaskVerdict:
    """How every model fared on one task — the column of the reward matrix."""

    slug: str
    per_model: dict[str, float]  # model -> mean reward on this task
    spread: dict[str, float]     # model -> within-group stdev (the GRPO signal)

    @property
    def best(self) -> float:
        return max(self.per_model.values(), default=0.0)

    @property
    def worst(self) -> float:
        return min(self.per_model.values(), default=0.0)

    @property
    def dead(self) -> bool:
        """No model got above the floor — suspect grader/answer, or impossible."""
        return self.best <= _FLOOR + _EPS

    @property
    def saturated(self) -> bool:
        """Every model maxed it — too easy, no training signal."""
        return bool(self.per_model) and self.worst >= 1.0 - _EPS

    @property
    def has_spread(self) -> bool:
        """Some within-group variance exists (or a partial mean) — RL has a gradient."""
        return any(s > _EPS for s in self.spread.values()) or any(
            _EPS < m < 1.0 - _EPS for m in self.per_model.values()
        )


@dataclass
class ModelRow:
    model: str
    mean: float
    per_task: dict[str, float]


@dataclass
class Leaderboard:
    group: int
    models: list[ModelRow]  # sorted descending by mean
    tasks: list[TaskVerdict]
    diagnostics: list[Diagnostic] = field(default_factory=list)

    @property
    def ceiling(self) -> float:
        return self.models[0].mean if self.models else 0.0

    @property
    def solvable(self) -> bool:
        return any(not t.dead for t in self.tasks)

    @property
    def discriminating(self) -> bool:
        """Some task gives partial signal (neither dead nor saturated)."""
        return any(not t.dead and not t.saturated for t in self.tasks)

    @property
    def has_errors(self) -> bool:
        return any(d.level == "error" for d in self.diagnostics)

    def to_dict(self) -> dict[str, Any]:
        return {
            "group": self.group,
            "ceiling": self.ceiling,
            "solvable": self.solvable,
            "discriminating": self.discriminating,
            "models": [{"model": r.model, "mean": r.mean, "per_task": r.per_task} for r in self.models],
            "tasks": [
                {"slug": t.slug, "best": t.best, "worst": t.worst, "per_model": t.per_model,
                 "dead": t.dead, "saturated": t.saturated, "has_spread": t.has_spread}
                for t in self.tasks
            ],
            "diagnostics": [{"level": d.level, "code": d.code, "message": d.message, "task_id": d.task_id}
                            for d in self.diagnostics],
        }


def aggregate(results: dict[str, dict[str, list[float]]], *, group: int) -> Leaderboard:
    """Reward matrix → leaderboard. `results` is model -> slug -> [per-rollout rewards]."""
    slugs = sorted({slug for per_slug in results.values() for slug in per_slug})
    models = sorted(results)

    tasks: list[TaskVerdict] = []
    for slug in slugs:
        per_model: dict[str, float] = {}
        spread: dict[str, float] = {}
        for model in models:
            rewards = results.get(model, {}).get(slug, [])
            per_model[model] = statistics.fmean(rewards) if rewards else 0.0
            spread[model] = statistics.pstdev(rewards) if len(rewards) > 1 else 0.0
        tasks.append(TaskVerdict(slug=slug, per_model=per_model, spread=spread))

    rows: list[ModelRow] = []
    for model in models:
        per_task = {t.slug: t.per_model[model] for t in tasks}
        mean = statistics.fmean(per_task.values()) if per_task else 0.0
        rows.append(ModelRow(model=model, mean=mean, per_task=per_task))
    rows.sort(key=lambda r: r.mean, reverse=True)

    lb = Leaderboard(group=group, models=rows, tasks=tasks)
    lb.diagnostics = _verdicts(lb)
    return lb


def _verdicts(lb: Leaderboard) -> list[Diagnostic]:
    diags: list[Diagnostic] = []
    if lb.tasks and not lb.solvable:
        diags.append(Diagnostic(level="error", code="baseline.unsolvable",
            message="No task was solved by any model — the env or graders are likely broken or impossible."))
    elif lb.tasks and not lb.discriminating:
        diags.append(Diagnostic(level="warn", code="baseline.not_discriminating",
            message="Every task is dead or saturated — no partial signal for RL to climb."))

    for t in lb.tasks:
        if t.dead and lb.solvable:  # unsolvable already reported env-wide
            diags.append(Diagnostic(level="warn", code="baseline.task_dead", task_id=t.slug,
                message=f"Task {t.slug!r}: every model scored ~0 — suspect grader/answer, or too hard."))
        elif t.saturated:
            diags.append(Diagnostic(level="info", code="baseline.task_saturated", task_id=t.slug,
                message=f"Task {t.slug!r}: every model maxed it — too easy, no training signal."))
        elif lb.group > 1 and not t.has_spread:
            diags.append(Diagnostic(level="warn", code="baseline.no_spread", task_id=t.slug,
                message=f"Task {t.slug!r}: no within-group reward spread — GRPO advantage is zero."))
    return diags


def render_leaderboard(lb: Leaderboard) -> str:
    lines = [
        f"Baseline (group={lb.group}) — ceiling {lb.ceiling:.3f}  "
        f"solvable={lb.solvable}  discriminating={lb.discriminating}",
        "",
    ]
    for i, row in enumerate(lb.models, 1):
        lines.append(f"  {i}. {row.model:<28} mean={row.mean:.3f}")
    if lb.tasks:
        lines += ["", "  per-task (best / worst across models):"]
        for t in lb.tasks:
            flag = "DEAD" if t.dead else ("SAT" if t.saturated else ("flat" if not t.has_spread else ""))
            lines.append(f"    {t.slug:<32} best={t.best:.2f} worst={t.worst:.2f}  {flag}")
    return "\n".join(lines)


# ── default benchmark set: a deliberately *spanning* range (weak → strong) ───
DEFAULT_MODELS = ["claude-haiku-4-5", "claude-sonnet-4-6", "claude-opus-4-8"]


@dataclass
class BaselinePlan:
    """What a baseline run *would* do (returned by dry_run, without executing)."""

    source: str
    models: list[str]
    group: int
    max_concurrent: int


def run_baseline(
    source: str | Path,
    models: list[str] | None = None,
    *,
    group: int = 4,
    max_concurrent: int = 10,
    dry_run: bool = False,
) -> Leaderboard | BaselinePlan:
    """Run every model across the task source and aggregate. `dry_run` skips all I/O."""
    models = list(models or DEFAULT_MODELS)
    if dry_run:
        return BaselinePlan(source=str(source), models=models, group=group, max_concurrent=max_concurrent)

    import asyncio

    return asyncio.run(_run_async(source, models, group=group, max_concurrent=max_concurrent))


def _load_taskset_and_runtime(source: str | Path):
    """A `.py` source serves itself via LocalRuntime; anything else is a platform taskset name."""
    from hud import Taskset

    text = str(source)
    if text.endswith(".py") or Path(text).exists():
        from hud.eval import LocalRuntime

        return Taskset.from_file(text), LocalRuntime(text)
    return Taskset.from_api(text), None  # remote default (HUDRuntime)


async def _run_async(source, models, *, group, max_concurrent) -> Leaderboard:
    from hud.agents import create_agent

    taskset, runtime = _load_taskset_and_runtime(source)
    results: dict[str, dict[str, list[float]]] = {}
    for model in models:
        agent = create_agent(model)
        kwargs: dict[str, Any] = {"group": group, "max_concurrent": max_concurrent}
        if runtime is not None:
            kwargs["runtime"] = runtime
        job = await taskset.run(agent, **kwargs)
        results[model] = {slug: [r.reward for r in runs] for slug, runs in job.results.items()}
    return aggregate(results, group=group)
