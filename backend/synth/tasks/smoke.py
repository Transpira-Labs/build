"""
Smoke-test a synthesized scenario — the trust-but-verify gate on a grader.

Mirrors the tool side's `smoke_test`:

  1. The scenario must compile.
  2. For a deterministic grader, instantiate it (a representative parameter combination
     for parameterized templates) and run it: feeding the user's OWN answer must score
     1.0 and a corruption must score lower. This catches a grader (LLM- or fallback-built)
     that doesn't honor the authored answer — the caller then drops to the fallback.
  3. An llm_judge grader is compiled only; its live check needs the judge model.

Inline check during synthesis, not the (skipped) standalone golden-gate step.
"""

from __future__ import annotations

import asyncio
from typing import Any

from synth.contracts import SmokeResult
from synth.tasks.grade import corrupt
from synth.tasks.spec import SynthesizedScenario


class _FakeEnv:
    def template(self, **_kw):
        return lambda fn: fn


def _run_grader(scn: SynthesizedScenario, answer: str, kwargs: dict[str, Any]) -> float:
    ns: dict[str, Any] = {"env": _FakeEnv()}
    for imp in scn.imports:
        exec(imp, ns)  # noqa: S102 - imports are canonical (hud.graders)
    exec(scn.source, ns)  # noqa: S102 - source is rendered by us, not the model
    fn = ns[scn.fn_name]

    async def drive() -> float:
        gen = fn(**kwargs)
        await gen.asend(None)          # 1st yield: the prompt
        return await gen.asend(answer)  # 2nd yield: the reward

    return asyncio.run(drive())


def smoke_scenario(
    scn: SynthesizedScenario,
    *,
    golden: str | None = None,
    kwargs: dict[str, Any] | None = None,
) -> SmokeResult:
    kwargs = kwargs or {}
    full = "\n".join(scn.imports) + "\n" + scn.source
    try:
        compile(full, f"<scenario:{scn.id}>", "exec")
    except SyntaxError as exc:
        return SmokeResult(status="failed", detail=f"syntax error: {exc}")

    if scn.grading_mode != "deterministic" or golden is None:
        return SmokeResult(status="compiled", detail="judge grader — live check deferred to eval time")

    try:
        good = _run_grader(scn, golden, kwargs)
        bad = _run_grader(scn, corrupt(golden), kwargs)
    except Exception as exc:  # noqa: BLE001
        return SmokeResult(status="failed", detail=f"grader raised: {exc!r}")

    if good >= 1.0 and bad < good:
        return SmokeResult(status="passed", detail=f"honors the authored answer (good={good}, wrong={bad})")
    return SmokeResult(
        status="failed",
        detail=f"grader does not honor the authored answer (good={good}, wrong={bad})",
    )
