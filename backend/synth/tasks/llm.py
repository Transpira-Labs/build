"""
LLM planner for task synthesis (tier 1).

Given a task (prompt + the user's authored answer) and the env's tools, the model
decides the *grading plan*: deterministic (there's a single checkable golden answer)
vs llm_judge (success is open-ended and only described), the rubric, and a refined
prompt grounded in the available tools. Returns a `ScenarioPlan`, or None when no key
is configured or the call fails — the caller then derives the plan from `answer_type`.

The model decides WHAT to grade; the grader CODE is rendered canonically downstream
(grade.py). The reward is the whole RL signal, so the model never writes it directly.

Access goes through the shared HUD gateway (`synth.tools.gateway.complete_json`), so
extraction, tool synthesis, and task synthesis all share one key and tracing.
"""

from __future__ import annotations

import json

from synth.tasks.adapt import NormalizedTask
from synth.tasks.spec import ScenarioPlan
from synth.tools.gateway import complete_json

_PLAN_SCHEMA = {
    "type": "object",
    "properties": {
        "prompt": {
            "type": "string",
            "description": "the task prompt to hand the agent; keep the user's intent and, when the env has tools, name the exact tool(s) the agent should call",
        },
        "mode": {
            "enum": ["deterministic", "llm_judge"],
            "description": "deterministic when one literal/numeric answer is checkable; llm_judge for open-ended success",
        },
        "expected": {
            "type": "string",
            "description": "deterministic only: the literal correct answer to compare against",
        },
        "match": {
            "enum": ["auto", "numeric", "text"],
            "description": "deterministic only: how to compare ('auto' picks numeric for numbers)",
        },
        "criteria": {
            "type": "array",
            "items": {"type": "string"},
            "description": "llm_judge only: 1-3 rubric points the judge scores against",
        },
    },
    "required": ["prompt", "mode"],
}

_SYSTEM = """You design the grading for one task in a reinforcement-learning environment.
Decide how the agent's result should be scored, and return a plan:
- mode "deterministic": success is a single checkable answer (a number, a name, a literal
  string). Put that literal in `expected`. Cheap and cannot be reward-hacked.
- mode "llm_judge": success is open-ended — the rubric describes a multi-step result or
  reasoning, not one literal. Give 1-3 concrete `criteria` describing what a correct result
  must show.
Rules:
- The user's authored answer_type is AUTHORITATIVE for `mode`: if it is "state" you MUST use
  llm_judge (capture the rubric as criteria — never collapse it to one literal, even when an
  obvious short answer like a letter or true/false is embedded in it); if "exact", use deterministic.
- Never write a grader that passes regardless of the work (no constant/echo/shape-only checks).
- A correct result MUST score 1.0 and a wrong one 0.0; honor the user's authored answer.
- Refine `prompt` so the agent knows what to do; do not leak the answer.
- When the env lists tools, the refined `prompt` MUST name the specific tool(s) the agent
  should call, by their exact names (e.g. "use `search_docs` to ..."), so the agent knows how
  to act. Reference every tool that is relevant to the task. If the env lists no tools, do not
  invent any — describe the task in plain terms.
Call emit_plan exactly once."""


def llm_plan_scenario(task: NormalizedTask, env_name: str, tool_names: set[str]) -> ScenarioPlan | None:
    tools_line = ", ".join(sorted(tool_names)) or "(none)"
    params_line = ", ".join(p.name for p in task.params) or "(none)"
    extras_line = json.dumps(task.extras, ensure_ascii=False) if task.extras else "(none)"
    user = (
        f"Environment: {env_name}\n"
        f"Available tools: {tools_line}\n"
        f"Task prompt: {task.prompt}\n"
        f"Template parameters (may appear as {{name}} in prompt/answer): {params_line}\n"
        f"User's authored answer_type: {task.answer_type}\n"
        f"User's authored answer: {task.answer}\n"
        f"Extra block fields (custom schema, may carry intent): {extras_line}"
    )
    data = complete_json(
        system=_SYSTEM,
        user=user,
        schema=_PLAN_SCHEMA,
        fn_name="emit_plan",
        fn_description="Emit the grading plan.",
    )
    if data is None:
        return None
    try:
        return ScenarioPlan.model_validate(data)
    except Exception as exc:  # noqa: BLE001 - malformed plan degrades to the deterministic fallback
        print(f"[task-synth] LLM plan invalid for {task.prompt[:40]!r} ({exc!r}).")
        return None
