"""Tasks synthesizer: turn v1 task blocks into verified HUD tasks (a Taskset)."""

from synth.tasks.grade import score_exact
from synth.tasks.spec import (
    GRADING_MODE,
    Diagnostic,
    ScenarioPlan,
    SynthesizedScenario,
    SynthesizedTaskset,
    grading_mode,
)
from synth.tasks.synthesizer import (
    synthesize_from_json,
    synthesize_scenario,
    synthesize_taskset,
)

__all__ = [
    "synthesize_taskset",
    "synthesize_scenario",
    "synthesize_from_json",
    "SynthesizedTaskset",
    "SynthesizedScenario",
    "ScenarioPlan",
    "Diagnostic",
    "GRADING_MODE",
    "grading_mode",
    "score_exact",
]
