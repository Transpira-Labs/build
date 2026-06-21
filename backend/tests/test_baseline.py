"""Tests for baseline eval (step 6): the pure reward-matrix aggregation + verdicts.

No network/models — `aggregate` is fed synthetic reward matrices. The runner is exercised
only via `dry_run`, which performs no I/O.
"""

from __future__ import annotations

from synth.eval import BaselinePlan, aggregate, render_leaderboard, run_baseline


def test_ranks_models_and_sets_ceiling():
    results = {
        "weak":   {"t1": [0.0, 0.0], "t2": [0.0, 1.0]},
        "strong": {"t1": [1.0, 1.0], "t2": [1.0, 1.0]},
    }
    lb = aggregate(results, group=2)
    assert [r.model for r in lb.models] == ["strong", "weak"]  # sorted desc by mean
    assert lb.ceiling == 1.0
    assert lb.solvable


def test_discriminating_when_partial_signal_exists():
    results = {
        "a": {"easy": [1.0, 1.0], "mid": [0.0, 1.0]},
        "b": {"easy": [1.0, 1.0], "mid": [0.0, 0.0]},
    }
    lb = aggregate(results, group=2)
    assert lb.discriminating  # 'mid' is neither dead nor saturated


def test_unsolvable_env_is_an_error():
    results = {"a": {"t1": [0.0, 0.0]}, "b": {"t1": [0.0, 0.0]}}
    lb = aggregate(results, group=2)
    assert not lb.solvable
    assert lb.has_errors
    assert any(d.code == "baseline.unsolvable" for d in lb.diagnostics)


def test_dead_task_flagged_when_env_otherwise_solvable():
    results = {
        "a": {"ok": [1.0, 1.0], "broken": [0.0, 0.0]},
        "b": {"ok": [1.0, 0.0], "broken": [0.0, 0.0]},
    }
    lb = aggregate(results, group=2)
    assert lb.solvable  # 'ok' works
    assert any(d.code == "baseline.task_dead" and d.task_id == "broken" for d in lb.diagnostics)


def test_saturated_task_is_info():
    results = {"a": {"easy": [1.0, 1.0]}, "b": {"easy": [1.0, 1.0]}}
    lb = aggregate(results, group=2)
    assert any(d.code == "baseline.task_saturated" for d in lb.diagnostics)


def test_no_within_group_spread_is_warned():
    # a partially-solved task across models, but every group is internally flat (all 0 or all 1)
    results = {
        "a": {"t": [1.0, 1.0]},   # flat at 1
        "b": {"t": [0.0, 0.0]},   # flat at 0
    }
    lb = aggregate(results, group=2)
    # mean across models is 0.5 (discriminating), but no within-group spread anywhere
    assert any(d.code == "baseline.no_spread" for d in lb.diagnostics)


def test_render_and_to_dict_roundtrip():
    lb = aggregate({"m": {"t1": [0.5, 1.0]}}, group=2)
    text = render_leaderboard(lb)
    assert "Baseline (group=2)" in text and "t1" in text
    d = lb.to_dict()
    assert d["group"] == 2 and d["models"][0]["model"] == "m"


def test_dry_run_makes_no_io():
    plan = run_baseline("out/env.py", ["claude-haiku-4-5", "gpt-5"], group=8, dry_run=True)
    assert isinstance(plan, BaselinePlan)
    assert plan.models == ["claude-haiku-4-5", "gpt-5"] and plan.group == 8
