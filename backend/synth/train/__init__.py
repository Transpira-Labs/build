"""Pipeline step 7 (training): managed RL through HUD's TrainingClient.

Pure helpers — `build_curve`, `assess_curve`, `precheck`, `select_high_reward` — read the
reward curve against the step-6 baseline and gate trainability. `run_training` drives the
managed GRPO loop (`TrainingClient.step` over grouped rollouts); `fork_model` mints the
trainable slug. Both need a HUD_API_KEY and are invoked explicitly.
"""

from synth.train.loop import (
    DEFAULT_LOSS,
    ForkResult,
    RewardCurve,
    TrainConfig,
    TrainingResult,
    TrainPlan,
    TrainPoint,
    assess_curve,
    build_curve,
    fork_model,
    precheck,
    run_training,
    select_high_reward,
)

__all__ = [
    "DEFAULT_LOSS",
    "ForkResult",
    "RewardCurve",
    "TrainConfig",
    "TrainingResult",
    "TrainPlan",
    "TrainPoint",
    "assess_curve",
    "build_curve",
    "fork_model",
    "precheck",
    "run_training",
    "select_high_reward",
]
