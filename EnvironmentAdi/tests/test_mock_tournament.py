"""The harness must run end-to-end on the mock backend, deterministically."""

from pathlib import Path

from environmentadi.backends import get_backend
from environmentadi.scoring import rank
from environmentadi.spec import load_specs
from environmentadi.tournament import run_tournament

SPECS = Path(__file__).parent.parent / "specs"
MODELS = ["gpt-mock", "claude-mock", "llama-mock"]


def _run():
    specs = load_specs(SPECS)
    return run_tournament(specs[: len(MODELS)], MODELS, get_backend("mock"))


def test_matrix_is_offdiagonal_and_complete():
    backend = get_backend("mock")
    specs = load_specs(SPECS)[: len(MODELS)]
    # Which models produced a valid env (and therefore a trained agent)?
    valid = [m for m, s in zip(MODELS, specs) if backend.build(s, m).valid]

    m = _run()
    # No self-play by default.
    assert all(a != e for (a, e) in m.cells)
    # Exactly the valid agents have rows...
    assert {a for a, _ in m.cells} == set(valid)
    # ...each scored against every other model's environment.
    assert len(m.cells) == len(valid) * (len(MODELS) - 1)


def test_scores_in_unit_interval():
    m = _run()
    assert all(0.0 <= s <= 1.0 for s in m.cells.values())


def test_deterministic():
    a = _run().cells
    b = _run().cells
    assert a == b


def test_rankings_cover_all_models():
    scores = rank(_run())
    assert {s.model for s in scores} == set(MODELS)
    # sorted descending by overall
    assert scores == sorted(scores, key=lambda s: s.overall, reverse=True)
