"""Pipeline step 6 (baseline eval): run benchmark models across the env, build a leaderboard.

`aggregate`/`Leaderboard` are pure reward-matrix math + the task-design verdicts (solvable,
discriminating, dead/saturated/no-spread tasks). `run_baseline` drives HUD to produce the
reward matrix; it needs a HUD_API_KEY and is invoked explicitly.
"""

from synth.eval.baseline import (
    DEFAULT_MODELS,
    BaselinePlan,
    Leaderboard,
    ModelRow,
    TaskVerdict,
    aggregate,
    render_leaderboard,
    run_baseline,
)

__all__ = [
    "DEFAULT_MODELS",
    "BaselinePlan",
    "Leaderboard",
    "ModelRow",
    "TaskVerdict",
    "aggregate",
    "render_leaderboard",
    "run_baseline",
]
