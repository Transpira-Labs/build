"""
Training loop (pipeline step 7) — managed RL through HUD.

The loop is the standard HUD managed GRPO: roll out a batch of grouped rollouts with the
current (trainable) model, hand the graded `Run`s to `TrainingClient.step`, which advances
the weights behind the model's gateway slug and checkpoints — so the next batch samples the
improved model. We always read the resulting **reward curve against the step-6 baseline**,
so the climb means something.

Three layers (mirroring deploy/baseline):
  • pure — `build_curve` / `assess_curve` / `precheck` over checkpoint + leaderboard data,
    fully offline-testable. This is the "read the curve" half.
  • gated runner — `run_training` drives `TrainingClient` + `taskset.run`; needs a
    HUD_API_KEY and a *trainable* model, costs real compute, runs only on request.
  • `fork_model` — shells out to `hud models fork` to mint the trainable slug.

GRPO needs within-group reward spread (advantage = reward − group_mean); if the step-6
baseline shows no spread, `precheck` refuses — training an all-equal taskset learns nothing.
Expert-iteration (rejection-sampling fine-tune, `loss_fn=cross_entropy` on high-reward runs)
is the reliable fallback mode.
"""

from __future__ import annotations

import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from synth.compile.deploy import _hud_executable, has_api_key
from synth.tasks.spec import Diagnostic

_EPS = 1e-6

#: HUD-managed built-in losses (discover the live set with trainer.available_losses())
DEFAULT_LOSS = "importance_sampling"  # on-policy PG; switch to "ppo" if a lucky rollout can blow up


# ── pure: the reward curve and its verdicts ──────────────────────────────────
@dataclass
class TrainPoint:
    step: int
    mean_reward: float
    reward_std: float | None = None
    checkpoint_id: str | None = None


@dataclass
class RewardCurve:
    points: list[TrainPoint] = field(default_factory=list)

    @property
    def start(self) -> float:
        return self.points[0].mean_reward if self.points else 0.0

    @property
    def end(self) -> float:
        return self.points[-1].mean_reward if self.points else 0.0

    @property
    def best(self) -> float:
        return max((p.mean_reward for p in self.points), default=0.0)

    @property
    def improvement(self) -> float:
        return self.end - self.start

    def to_dict(self) -> dict[str, Any]:
        return {
            "start": self.start, "end": self.end, "best": self.best, "improvement": self.improvement,
            "points": [
                {"step": p.step, "mean_reward": p.mean_reward,
                 "reward_std": p.reward_std, "checkpoint_id": p.checkpoint_id}
                for p in self.points
            ],
        }


def build_curve(checkpoints: list[dict]) -> RewardCurve:
    """Build the reward curve from checkpoint nodes (each: mean_reward + metrics.reward_std)."""
    points: list[TrainPoint] = []
    for i, ckpt in enumerate(checkpoints, 1):
        metrics = ckpt.get("metrics") or {}
        points.append(TrainPoint(
            step=i,
            mean_reward=float(ckpt.get("mean_reward") or 0.0),
            reward_std=metrics.get("reward_std"),
            checkpoint_id=ckpt.get("id"),
        ))
    return RewardCurve(points=points)


def assess_curve(curve: RewardCurve, *, baseline_ceiling: float | None = None) -> list[Diagnostic]:
    """Read the curve: did it climb, plateau, regress, or pass the baseline ceiling?"""
    diags: list[Diagnostic] = []
    if not curve.points:
        diags.append(Diagnostic(level="warn", code="train.no_checkpoints",
            message="No checkpoints were produced — training did not advance the model."))
        return diags

    if curve.improvement > _EPS:
        diags.append(Diagnostic(level="info", code="train.improved",
            message=f"Reward rose {curve.start:.3f} → {curve.end:.3f} (+{curve.improvement:.3f})."))
    elif curve.improvement < -_EPS:
        diags.append(Diagnostic(level="warn", code="train.regressed",
            message=f"Reward fell {curve.start:.3f} → {curve.end:.3f}; consider rolling the head back "
                    "(set_head) or lowering the learning rate."))
    else:
        diags.append(Diagnostic(level="warn", code="train.flat",
            message="Reward did not move — check for within-group spread and the learning rate."))

    if baseline_ceiling is not None and curve.best > baseline_ceiling + _EPS:
        diags.append(Diagnostic(level="info", code="train.surpassed_baseline",
            message=f"Best checkpoint {curve.best:.3f} passed the step-6 baseline ceiling "
                    f"{baseline_ceiling:.3f}."))

    if len(curve.points) >= 3:
        tail = [p.mean_reward for p in curve.points[-3:]]
        if max(tail) - min(tail) <= _EPS:
            diags.append(Diagnostic(level="info", code="train.plateaued",
                message="The last 3 steps are flat — training has plateaued."))
    return diags


def precheck(*, solvable: bool, discriminating: bool) -> list[Diagnostic]:
    """Trainability gate from the step-6 baseline: GRPO needs spread, the env must be solvable."""
    diags: list[Diagnostic] = []
    if not solvable:
        diags.append(Diagnostic(level="error", code="train.unsolvable",
            message="Baseline shows no task is solvable — training has no signal to learn from."))
    if not discriminating:
        diags.append(Diagnostic(level="error", code="train.no_spread",
            message="Baseline shows no within-group/partial reward spread — GRPO advantage is zero; "
                    "fix the tasks (add difficulty/seeds) before training."))
    return diags


def select_high_reward(rewards: list[float], threshold: float) -> list[int]:
    """Indices of rollouts at/above the reward threshold (expert-iteration's keep-set)."""
    return [i for i, r in enumerate(rewards) if r >= threshold]


# ── config + result ──────────────────────────────────────────────────────────
@dataclass
class TrainConfig:
    model_slug: str  # the trainable gateway slug (what you sample AND train)
    steps: int = 10
    group: int = 8
    learning_rate: float = 1e-5
    loss_fn: str | None = DEFAULT_LOSS
    mode: str = "grpo"  # "grpo" | "expert_iteration"
    reward_threshold: float = 0.5  # expert-iteration keep-threshold

    def validate(self) -> list[Diagnostic]:
        diags: list[Diagnostic] = []
        if self.steps < 1:
            diags.append(Diagnostic(level="error", code="train.bad_steps", message="steps must be >= 1."))
        if self.group < 1:
            diags.append(Diagnostic(level="error", code="train.bad_group", message="group must be >= 1."))
        if self.learning_rate <= 0:
            diags.append(Diagnostic(level="error", code="train.bad_lr", message="learning_rate must be > 0."))
        if self.mode not in ("grpo", "expert_iteration"):
            diags.append(Diagnostic(level="error", code="train.bad_mode",
                message=f"unknown mode {self.mode!r} (grpo | expert_iteration)."))
        return diags


@dataclass
class TrainPlan:
    source: str
    config: TrainConfig
    est_rollouts_per_step: str = "tasks × group"


@dataclass
class TrainingResult:
    model_slug: str
    curve: RewardCurve
    head_id: str | None = None
    baseline_ceiling: float | None = None
    diagnostics: list[Diagnostic] = field(default_factory=list)
    ok: bool = True

    def to_dict(self) -> dict[str, Any]:
        return {
            "model_slug": self.model_slug,
            "head_id": self.head_id,
            "baseline_ceiling": self.baseline_ceiling,
            "curve": self.curve.to_dict(),
            "diagnostics": [{"level": d.level, "code": d.code, "message": d.message} for d in self.diagnostics],
            "ok": self.ok,
        }


# ── gated: fork a trainable model ────────────────────────────────────────────
@dataclass
class ForkResult:
    ok: bool
    command: list[str]
    slug: str | None = None
    message: str = ""


def fork_model(base: str, name: str, *, dry_run: bool = False) -> ForkResult:
    """`hud models fork <base> --name <name>` → a team-owned trainable slug."""
    hud = _hud_executable()
    if hud is None:
        return ForkResult(ok=False, command=[], message="the `hud` CLI is not installed")
    cmd = [hud, "models", "fork", base, "--name", name]
    if dry_run:
        return ForkResult(ok=True, command=cmd, slug=name, message="dry run — command not executed")
    proc = subprocess.run(cmd)
    ok = proc.returncode == 0
    return ForkResult(ok=ok, command=cmd, slug=name if ok else None,
                      message="forked" if ok else f"`hud models fork` exited {proc.returncode}")


# ── gated: the training loop ─────────────────────────────────────────────────
def run_training(
    config: TrainConfig,
    source: str | Path,
    *,
    baseline: dict | None = None,
    dry_run: bool = False,
) -> TrainingResult | TrainPlan:
    """Run the managed RL loop. `baseline` is a step-6 leaderboard dict for the trainability gate."""
    diags = config.validate()
    if baseline is not None:
        diags += precheck(solvable=bool(baseline.get("solvable", True)),
                          discriminating=bool(baseline.get("discriminating", True)))

    if dry_run:
        return TrainPlan(source=str(source), config=config)

    if any(d.level == "error" for d in diags):
        return TrainingResult(model_slug=config.model_slug, curve=RewardCurve(),
                              diagnostics=diags, ok=False,
                              baseline_ceiling=(baseline or {}).get("ceiling"))

    import asyncio

    return asyncio.run(_train_async(config, source, diags, baseline))


async def _train_async(config, source, diags, baseline) -> TrainingResult:
    from hud import Job, TrainingClient
    from hud.agents import create_agent

    from synth.eval.baseline import _load_taskset_and_runtime

    agent = create_agent(config.model_slug, completion_kwargs={"extra_body": {"return_token_ids": True}})
    trainer = TrainingClient(config.model_slug)
    taskset, runtime = _load_taskset_and_runtime(source)

    session = await Job.start(config.model_slug, group=config.group)
    for _ in range(config.steps):
        start = len(session.runs)
        run_kwargs: dict[str, Any] = {"group": config.group, "job": session}
        if runtime is not None:
            run_kwargs["runtime"] = runtime
        await taskset.run(agent, **run_kwargs)
        batch = session.runs[start:]

        if config.mode == "expert_iteration":
            keep = select_high_reward([r.reward for r in batch], config.reward_threshold)
            batch = [batch[i] for i in keep]
            if not batch:
                continue
            await trainer.step(batch, learning_rate=config.learning_rate,
                               group_size=None, loss_fn="cross_entropy")
        else:
            step_kwargs: dict[str, Any] = {"learning_rate": config.learning_rate, "group_size": config.group}
            if config.loss_fn:
                step_kwargs["loss_fn"] = config.loss_fn
            await trainer.step(batch, **step_kwargs)

    checkpoints = await trainer.checkpoints()
    curve = build_curve([_ckpt_to_dict(c) for c in checkpoints])
    head = await trainer.head()
    ceiling = (baseline or {}).get("ceiling")

    diags = diags + assess_curve(curve, baseline_ceiling=ceiling)
    return TrainingResult(
        model_slug=config.model_slug, curve=curve,
        head_id=getattr(head, "id", None), baseline_ceiling=ceiling,
        diagnostics=diags, ok=True,
    )


def _ckpt_to_dict(ckpt: Any) -> dict:
    """Normalize a CheckpointResponse (or dict) into the shape build_curve reads."""
    if isinstance(ckpt, dict):
        return ckpt
    return {
        "id": getattr(ckpt, "id", None),
        "mean_reward": getattr(ckpt, "mean_reward", None),
        "metrics": getattr(ckpt, "metrics", None) or {},
    }
