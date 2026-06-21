"""Read a cross-play ScoreMatrix into per-model rankings.

Two qualities, per the benchmark design:

  * training_ground — off-diagonal *row* mean for model i: do agents trained in
    envᵢ perform well across everyone else's environments?
  * golden_benchmark — *column* discrimination for model j: does envⱼ spread
    agents apart (high variance), rather than scoring everyone the same?

`overall` combines them so a single leaderboard can be printed; tune the weights
as the benchmark matures.
"""

from __future__ import annotations

from dataclasses import dataclass
from statistics import mean, pstdev

from .artifacts import ScoreMatrix


@dataclass
class ModelScore:
    model: str
    training_ground: float   # mean reward agents-of-this-model earn elsewhere
    golden_benchmark: float  # how discriminative this model's env is (0..1)
    n_eval: int              # cells contributing to training_ground
    overall: float


def _offdiag(matrix: ScoreMatrix, *, agent: str | None = None, env: str | None = None) -> list[float]:
    out = []
    for (a, e), s in matrix.cells.items():
        if not matrix.include_diagonal and a == e:
            continue
        if agent is not None and a != agent:
            continue
        if env is not None and e != env:
            continue
        out.append(s)
    return out


def rank(matrix: ScoreMatrix, *, ground_weight: float = 0.6) -> list[ModelScore]:
    scores: list[ModelScore] = []
    for m in matrix.models:
        row = _offdiag(matrix, agent=m)          # this model's agents elsewhere
        col = _offdiag(matrix, env=m)            # others' agents on this env
        ground = mean(row) if row else 0.0
        # Discrimination: normalized spread of the column. A column that is all
        # 0s or all 1s tells you nothing; one that spreads is a good benchmark.
        spread = pstdev(col) if len(col) > 1 else 0.0
        golden = min(1.0, spread / 0.5)          # 0.5 std ≈ maximally split
        overall = ground_weight * ground + (1 - ground_weight) * golden
        scores.append(
            ModelScore(
                model=m,
                training_ground=round(ground, 4),
                golden_benchmark=round(golden, 4),
                n_eval=len(row),
                overall=round(overall, 4),
            )
        )
    scores.sort(key=lambda s: s.overall, reverse=True)
    return scores


def format_matrix(matrix: ScoreMatrix) -> str:
    """Render the cross-play matrix as a text table (rows=agents, cols=envs)."""
    models = matrix.models
    w = max((len(m) for m in models), default=6)
    head = " " * (w + 2) + "  ".join(f"{m[:6]:>6}" for m in models)
    lines = [head, "  agent\\env (cols)"]
    for a in models:
        cells = []
        for e in models:
            s = matrix.get(a, e)
            cells.append("   -  " if s is None else f"{s:6.3f}")
        lines.append(f"{a:<{w}}  " + "  ".join(cells))
    return "\n".join(lines)


def format_rankings(scores: list[ModelScore]) -> str:
    lines = [f"{'rank':<5}{'model':<16}{'overall':>9}{'train-grnd':>12}{'golden':>9}"]
    for i, s in enumerate(scores, 1):
        lines.append(
            f"{i:<5}{s.model:<16}{s.overall:>9.3f}{s.training_ground:>12.3f}{s.golden_benchmark:>9.3f}"
        )
    return "\n".join(lines)
