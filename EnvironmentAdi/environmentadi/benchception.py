"""bench-ception: a HUD environment whose task is to BUILD a HUD environment.

The agent for this env is a *builder model* (gpt-5.5 / qwen3-coder /
claude-sonnet-4-6 / claude-opus-4-8). Given a rough spec it must return a runnable
HUD environment module as code. The grader then runs a *probe model* on the
submitted environment via a nested HUD eval and returns the probe's mean reward.

So this is "bench-ception": a HUD environment that evaluates the act of creating
HUD environments. Run it like any HUD env, one builder per run:

    hud eval environmentadi/benchception.py gpt-5.5 --gateway
    hud eval environmentadi/benchception.py claude-opus-4-8 --gateway   # golden author

Phase 1 (now): no training — the probe runs untrained, the reward just confirms
the built environment loads, runs, and grades. Phase 2 swaps the probe for a
trainee trained on the submitted env (when Tinker training is available).
"""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

from hud import Environment

env = Environment(name="bench-ception")

# Probe / trainee that runs inside the grader (Qwen3-8B — works on the v6 beta
# gateway and is the Phase-2 RL target). Override via BENCHCEPTION_PROBE.
PROBE_MODEL = os.environ.get("BENCHCEPTION_PROBE", "Qwen/Qwen3-8B")

# The rough environment specification handed to the builder.
DEFAULT_SPEC = {
    "name": "Letter Count",
    "objective": "Count how many times a given letter appears in a word.",
    "inputs": "A word and a target letter.",
    "outputs": "A single integer: the count.",
    "tasks": [
        {
            "prompt": "How many 'r's are in 'strawberry'? Reply with just the number.",
            "reward": "answer == 3 -> 1.0 else 0.0",
        }
    ],
}

BUILD_INSTRUCTIONS = """\
You are an expert at the HUD SDK (v6). Build a runnable HUD environment that
realizes the specification below. Return ONE Python module and nothing else
(no prose, no markdown fences), in this shape:

    from hud import Environment
    env = Environment(name="<short-name>")

    # TOOLS: realize every tool in the spec as an @env.tool stub that returns
    # PLAUSIBLE, SELF-CONSISTENT fixture data for the IDs named in the task, so
    # the task has a knowable correct answer the grader can check against.
    @env.tool()
    def <tool_name>(<arg>: <type>) -> <type>:
        \"\"\"<what it does>\"\"\"
        ...  # return fixture data

    # TASKS: realize each task as an @env.template with exactly two yields.
    @env.template()
    async def <task>(...):
        answer = yield "<prompt>"
        # REWARD in [0,1]: implement the task's grading. Plain Python is safest.
        # You MAY use helpers from hud.graders — but ONLY these names exist:
        #   exact_match, contains, contains_all, contains_any, numeric_match,
        #   f1_score, judge (LLM judge), combine, combine_all, combine_any.
        # For a rubric (good/bad), score the answer against the fixture
        # ground-truth and the rubric (heuristic and/or judge). Partial credit ok.
        yield <reward>

    tasks = [<task>(...)]   # REQUIRED: instantiated rows

The module MUST import cleanly (do NOT import names that don't exist), end with a
`tasks = [...]` list of instantiated rows, and need no API key or network at
import time. Keep all fixture data inside the module.

Specification:
"""


def _load_spec_text() -> str:
    f = os.environ.get("BENCHCEPTION_SPEC_FILE")
    if f and Path(f).exists():
        return Path(f).read_text()
    return json.dumps(DEFAULT_SPEC, indent=2)


SPEC_TEXT = _load_spec_text()


def _strip_fences(text: str) -> str:
    t = (text or "").strip()
    if t.startswith("```"):
        lines = t.splitlines()[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        return "\n".join(lines).strip()
    return t


async def _grade_submitted_env(code: str, probe_model: str = PROBE_MODEL) -> tuple[float, dict]:
    """Run `probe_model` on the submitted environment; return (mean_reward, detail).

    This is the nested HUD eval: a fresh Taskset + agent + LocalRuntime over the
    builder's submitted module, executed from inside this env's grader.
    """
    raw = code
    code = _strip_fences(code)

    def _dump(detail: dict) -> None:
        # Persist exactly what the builder submitted, keyed by builder model.
        dbg = os.environ.get("BENCHCEPTION_SAVE_DIR") or os.environ.get("BENCHCEPTION_DEBUG_DIR")
        if not dbg:
            return
        d = Path(dbg)
        d.mkdir(parents=True, exist_ok=True)
        builder = os.environ.get("BENCHCEPTION_BUILDER", "unknown").replace("/", "_")
        (d / f"{builder}.py").write_text(code)
        (d / f"{builder}.detail.json").write_text(json.dumps(detail, indent=2))

    if "Environment(" not in code or "tasks" not in code:
        detail = {"reason": "submission missing env/tasks", "raw_len": len(raw),
                  "raw_head": raw[:200]}
        _dump(detail)
        return 0.0, detail

    workdir = Path(tempfile.mkdtemp(prefix="benchception_"))
    env_path = workdir / "env.py"
    env_path.write_text(code)
    _dump({"stage": "saved", "raw_len": len(raw), "raw_head": raw[:200]})
    try:
        from hud.agents import create_agent
        from hud.eval import LocalRuntime, Taskset

        ts = Taskset.from_file(str(env_path))
        if len(ts) == 0:
            detail = {"reason": "submitted env loaded 0 tasks"}
            _dump(detail)
            return 0.0, detail

        # Average several probe rollouts per task — single rollouts are noisy
        # (a chatty answer can fail a strict grader by chance).
        group = int(os.environ.get("BENCHCEPTION_GROUP", "3"))
        probe = create_agent(probe_model)
        job = await ts.run(
            probe, runtime=LocalRuntime(str(env_path)), group=group, max_concurrent=group
        )
        rewards = [r.reward for r in job.runs if r.reward is not None]
        score = sum(rewards) / len(rewards) if rewards else 0.0
        detail = {"probe": probe_model, "n_tasks": len(ts), "group": group,
                  "n_runs": len(rewards), "score": score}
        _dump(detail)
        return score, detail
    except Exception as e:  # noqa: BLE001 - a broken submission just scores 0
        detail = {"reason": f"{type(e).__name__}: {e}"}
        _dump(detail)
        return 0.0, detail


@env.template()
async def forge(spec: str = SPEC_TEXT):
    code = yield BUILD_INSTRUCTIONS + spec
    score, _detail = await _grade_submitted_env(code)
    yield score


tasks = [forge()]
