"""Tests for training (step 7): the pure curve / verdict / gate logic + dry-run.

No HUD, no GPUs — `build_curve`/`assess_curve`/`precheck` run on synthetic checkpoint and
leaderboard data; the runner is exercised only via dry_run / config validation.
"""

from __future__ import annotations

from synth.train import (
    TrainConfig,
    TrainPlan,
    assess_curve,
    build_curve,
    fork_model,
    precheck,
    run_training,
    select_high_reward,
)


def _ckpts(rewards, stds=None):
    stds = stds or [None] * len(rewards)
    return [{"id": f"c{i}", "mean_reward": r, "metrics": {"reward_std": s}}
            for i, (r, s) in enumerate(zip(rewards, stds))]


def test_build_curve_from_checkpoints():
    curve = build_curve(_ckpts([0.1, 0.3, 0.55], [0.2, 0.25, 0.3]))
    assert len(curve.points) == 3
    assert curve.start == 0.1 and curve.end == 0.55 and curve.best == 0.55
    assert round(curve.improvement, 3) == 0.45
    assert curve.points[0].checkpoint_id == "c0"


def test_assess_curve_improved_and_surpassed_baseline():
    curve = build_curve(_ckpts([0.2, 0.4, 0.7]))
    diags = assess_curve(curve, baseline_ceiling=0.5)
    codes = {d.code for d in diags}
    assert "train.improved" in codes
    assert "train.surpassed_baseline" in codes


def test_assess_curve_regressed_is_warned():
    curve = build_curve(_ckpts([0.6, 0.4, 0.2]))
    diags = assess_curve(curve)
    assert any(d.code == "train.regressed" and d.level == "warn" for d in diags)


def test_assess_curve_plateau():
    curve = build_curve(_ckpts([0.2, 0.5, 0.5, 0.5]))
    assert any(d.code == "train.plateaued" for d in assess_curve(curve))


def test_assess_curve_no_checkpoints():
    assert any(d.code == "train.no_checkpoints" for d in assess_curve(build_curve([])))


def test_precheck_blocks_when_no_spread():
    diags = precheck(solvable=True, discriminating=False)
    assert any(d.code == "train.no_spread" and d.level == "error" for d in diags)


def test_precheck_passes_when_spread_present():
    assert precheck(solvable=True, discriminating=True) == []


def test_select_high_reward():
    assert select_high_reward([0.0, 0.5, 0.9, 0.2], 0.5) == [1, 2]


def test_config_validation_catches_bad_values():
    bad = TrainConfig(model_slug="m", steps=0, group=0, learning_rate=0.0, mode="nope")
    codes = {d.code for d in bad.validate()}
    assert {"train.bad_steps", "train.bad_group", "train.bad_lr", "train.bad_mode"} <= codes


def test_run_training_refuses_untrainable_baseline():
    # a baseline with no spread → run_training returns a refusal (no I/O), not a crash
    cfg = TrainConfig(model_slug="arith-rl", steps=3, group=4)
    result = run_training(cfg, "out/env.py", baseline={"solvable": True, "discriminating": False})
    assert result.ok is False
    assert any(d.code == "train.no_spread" for d in result.diagnostics)


def test_dry_run_returns_plan_without_io():
    cfg = TrainConfig(model_slug="arith-rl", steps=5, group=8)
    plan = run_training(cfg, "out/env.py", dry_run=True)
    assert isinstance(plan, TrainPlan)
    assert plan.config.steps == 5 and plan.config.model_slug == "arith-rl"


def test_fork_model_dry_run_builds_command():
    res = fork_model("Qwen/Qwen3.5-4B", "arith-rl", dry_run=True)
    assert res.ok and res.slug == "arith-rl"
    assert res.command[1:4] == ["models", "fork", "Qwen/Qwen3.5-4B"]
