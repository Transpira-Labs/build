"""Tests for the run registry (step 8): store keying, honest comparison, routing, persistence."""

from __future__ import annotations

from synth.registry import Registry, route


def _lb(ceiling, *, solvable=True, discriminating=True):
    return {"ceiling": ceiling, "solvable": solvable, "discriminating": discriminating, "models": [], "tasks": []}


def _train(model, best, head="ckpt-9"):
    return {"model_slug": model, "head_id": head, "curve": {"best": best, "start": 0.1, "end": best, "points": []}}


def test_record_and_compare_delta():
    reg = Registry()
    reg.record_baseline("research_agent", "0.1.0+abc", _lb(0.6), at="t0")
    reg.record_training("research_agent", "0.1.0+abc", _train("arith-rl", 0.81), base="Qwen", at="t1")

    cmp = reg.compare("research_agent", "0.1.0+abc")
    assert cmp["found"] and cmp["honest"]
    assert cmp["baseline_ceiling"] == 0.6 and cmp["trained_best"] == 0.81
    assert abs(cmp["delta"] - 0.21) < 1e-9
    assert cmp["model_slug"] == "arith-rl" and cmp["head_id"] == "ckpt-9"


def test_compare_picks_best_training_run():
    reg = Registry()
    reg.record_baseline("e", "v1", _lb(0.5))
    reg.record_training("e", "v1", _train("m", 0.7))
    reg.record_training("e", "v1", _train("m", 0.9))  # later, better
    assert reg.compare("e", "v1")["trained_best"] == 0.9


def test_versions_do_not_cross_compare():
    reg = Registry()
    reg.record_baseline("e", "v1", _lb(0.5))
    reg.record_training("e", "v2", _train("m", 0.9))  # different version
    # v1 has a baseline but no training; v2 has training but no baseline — neither is "honest"
    assert reg.compare("e", "v1")["trained_best"] is None
    assert reg.compare("e", "v2")["baseline_ceiling"] is None
    assert reg.compare("e", "v1")["honest"] is False
    assert reg.compare("e", "v2")["honest"] is False
    assert reg.versions("e") == ["v1", "v2"]


def test_persistence_roundtrip(tmp_path):
    path = tmp_path / "registry.json"
    reg = Registry.load(path)
    reg.record_baseline("e", "v1", _lb(0.5), at="t0")
    reg.save()

    reloaded = Registry.load(path)
    assert reloaded.environments() == ["e"]
    assert reloaded.get("e", "v1")["baseline"]["ceiling"] == 0.5


def test_accepts_objects_with_to_dict():
    class Fake:
        def to_dict(self):
            return _lb(0.42)

    reg = Registry()
    reg.record_baseline("e", "v1", Fake())
    assert reg.get("e", "v1")["baseline"]["ceiling"] == 0.42


# ── HTTP routing (pure, no socket) ───────────────────────────────────────────
def _seeded():
    reg = Registry()
    reg.record_baseline("research_agent", "v1", _lb(0.6), at="t0")
    reg.record_training("research_agent", "v1", _train("arith-rl", 0.8), at="t1")
    return reg


def test_route_environments():
    status, body = route(_seeded(), "/environments")
    assert status == 200 and body["environments"] == ["research_agent"]


def test_route_env_versions_and_bucket():
    reg = _seeded()
    assert route(reg, "/env/research_agent")[1]["versions"] == ["v1"]
    status, bucket = route(reg, "/env/research_agent/v1")
    assert status == 200 and bucket["baseline"]["ceiling"] == 0.6


def test_route_compare():
    status, body = route(_seeded(), "/env/research_agent/v1/compare")
    assert status == 200 and body["honest"] and abs(body["delta"] - 0.2) < 1e-9


def test_route_unknown_is_404():
    assert route(_seeded(), "/nope")[0] == 404
    assert route(_seeded(), "/env/research_agent/v999")[0] == 404
