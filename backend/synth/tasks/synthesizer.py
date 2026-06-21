"""
The tasks synthesizer (pipeline step 3).

Schema-agnostic and forward-compatible: every entry point routes raw input through the
adapter (`adapt.py`), which normalizes ANY task shape — canonical TaskBlock, an unknown
versioned schema, or a custom block — into a `NormalizedTask` (prompt, answer_type,
answer, parameters, preserved extras) without crashing.

Each task becomes a `SynthesizedScenario` (a runnable `@env.template()` + grader) via the
same two-tier strategy as the tool synthesizer:

    1. LLM plan   — the model decides the grading (deterministic vs judge), rubric, and a
                    refined prompt; the grader code is rendered canonically from it.
    2. deterministic fallback — derive the plan from `answer_type` when no key is
                    configured, or when the LLM grader fails its smoke check.

Parameters drive Taskset expansion: one template with `values` mints many concrete tasks.
"""

from __future__ import annotations

import re
from typing import Any

from synth.tasks.adapt import NormalizedTask, NormParam, adapt_tasks
from synth.tasks.grade import (
    DEFAULT_JUDGE_MODEL,
    build_template_source,
    py_literal,
    render_plan,
)
from synth.tasks.llm import llm_plan_scenario
from synth.tasks.smoke import smoke_scenario
from synth.tasks.spec import (
    Diagnostic,
    ScenarioPlan,
    SynthesizedScenario,
    SynthesizedTaskset,
)

_ENV_VAR = "env"
_MAX_COMBOS = 64  # cap parameter expansion so a huge grid can't explode the taskset
_KEYWORDS = {"def", "class", "return", "yield", "async", "await", "for", "if", "in",
             "is", "or", "and", "not", "from", "import", "as", "with", "pass",
             "lambda", "global", "while", "try", "else"}


def _slug(text: str, fallback: str) -> str:
    words = re.sub(r"[^a-z0-9]+", " ", (text or "").lower()).split()[:6]
    base = "_".join(words).strip("_") or fallback
    if base[0].isdigit():
        base = f"t_{base}"
    if base in _KEYWORDS:
        base = f"{base}_"
    return base


def _looks_open_ended(answer: str) -> bool:
    a = answer.strip()
    return len(a) > 80 or a.count(".") >= 2 or len(a.split()) > 14


def _signature(params: list[NormParam]) -> str:
    return ", ".join(f"{p.name}: {p.annotation()} = {p.default_literal()}" for p in params)


def _empty(ptype: str) -> Any:
    return {"int": 0, "float": 0.0, "bool": False}.get(ptype, "")


def _first_combo(params: list[NormParam]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for p in params:
        out[p.name] = p.values[0] if p.values else (p.default if p.default is not None else _empty(p.type))
    return out


def _calls(fn_name: str, params: list[NormParam]) -> tuple[list[str], bool]:
    """Concrete call expressions for the Taskset (cartesian over params with `values`)."""
    varying = [p for p in params if p.values]
    if not varying:
        return [f"{fn_name}()"], False
    combos: list[dict[str, Any]] = [{}]
    for p in varying:
        combos = [{**c, p.name: v} for c in combos for v in p.values]
    # dedupe identical combinations — the real Taskset indexes by slug (id+args)
    # and rejects duplicates, so repeated param values must not mint twin rows.
    seen: set[tuple] = set()
    unique: list[dict[str, Any]] = []
    for c in combos:
        key = tuple(sorted(c.items()))
        if key not in seen:
            seen.add(key)
            unique.append(c)
    combos = unique
    capped = len(combos) > _MAX_COMBOS
    combos = combos[:_MAX_COMBOS]
    calls = [
        f"{fn_name}(" + ", ".join(f"{k}={py_literal(v)}" for k, v in c.items()) + ")"
        for c in combos
    ]
    return calls, capped


def _subst(s: str, combo: dict[str, Any]) -> str:
    for k, v in combo.items():
        s = s.replace("{" + k + "}", str(v))
    return s


def _fallback_plan(task: NormalizedTask) -> ScenarioPlan:
    if task.answer_type == "exact":
        return ScenarioPlan(prompt=task.prompt, mode="deterministic", expected=task.answer)
    return ScenarioPlan(prompt=task.prompt, mode="llm_judge", criteria=[task.answer] if task.answer else [])


def _render(plan: ScenarioPlan, task: NormalizedTask, fn_name: str, task_id: str, judge_model: str, origin: str) -> SynthesizedScenario:
    names = task.param_names
    body, imports, mode = render_plan(plan, judge_model, param_names=names)
    source = build_template_source(
        _ENV_VAR, task_id, fn_name, plan.prompt, body,
        signature=_signature(task.params), param_names=names,
    )
    calls, _capped = _calls(fn_name, task.params)
    return SynthesizedScenario(
        id=task_id, fn_name=fn_name, prompt=plan.prompt, grading_mode=mode,
        source=source, imports=imports, calls=calls, origin=origin,
    )


def _smoke(scn: SynthesizedScenario, task: NormalizedTask) -> None:
    combo = _first_combo(task.params)
    golden = _subst(task.answer, combo) if (scn.grading_mode == "deterministic" and task.answer) else None
    scn.smoke = smoke_scenario(scn, golden=golden, kwargs=combo)


def synthesize_scenario(
    task: Any,
    *,
    env_name: str,
    fn_name: str,
    task_id: str,
    tool_names: set[str] | None = None,
    use_llm: bool = True,
    judge_model: str = DEFAULT_JUDGE_MODEL,
) -> SynthesizedScenario:
    nt = task if isinstance(task, NormalizedTask) else _coerce(task)
    tool_names = tool_names or set()
    diags: list[Diagnostic] = []

    plan = llm_plan_scenario(nt, env_name, tool_names) if use_llm else None
    origin = "llm" if plan is not None else "deterministic"
    if plan is None:
        plan = _fallback_plan(nt)
    if not plan.prompt.strip():
        plan.prompt = nt.prompt

    scn = _render(plan, nt, fn_name, task_id, judge_model, origin)
    _smoke(scn, nt)

    # trust-but-verify: an LLM grader that fails smoke → deterministic fallback
    if scn.smoke.status == "failed" and origin == "llm":
        diags.append(Diagnostic(level="warn", code="llm.grader_rejected", task_id=task_id,
                                message=f"LLM grader failed smoke ({scn.smoke.detail}); using the deterministic fallback."))
        scn = _render(_fallback_plan(nt), nt, fn_name, task_id, judge_model, "deterministic")
        _smoke(scn, nt)

    # advisory diagnostics
    if not nt.answer.strip() and scn.grading_mode == "deterministic":
        diags.append(Diagnostic(level="error", code="task.empty_answer", task_id=task_id,
                                message="Deterministic task has no answer to compare against."))
    if scn.grading_mode == "deterministic" and _looks_open_ended(nt.answer):
        diags.append(Diagnostic(level="warn", code="exact.looks_open_ended", task_id=task_id,
                                message="Deterministic grading but the answer reads like prose; correct work may score 0."))
    if scn.grading_mode == "llm_judge" and sum(len(c.split()) for c in plan.criteria) < 4:
        diags.append(Diagnostic(level="info", code="state.thin_criteria", task_id=task_id,
                                message="Very thin judge rubric; a vague criterion gives little signal."))
    if len(scn.calls) > 1:
        diags.append(Diagnostic(level="info", code="task.parameterized", task_id=task_id,
                                message=f"Expanded to {len(scn.calls)} concrete tasks across parameters."))
    if tool_names and not any(re.search(rf"\b{re.escape(tn)}\b", scn.prompt) for tn in tool_names):
        diags.append(Diagnostic(level="info", code="task.no_tool_reference", task_id=task_id,
                                message="Prompt names none of the project's tools; the agent may not know how to act."))

    scn.diagnostics = diags + scn.diagnostics
    return scn


def _coerce(task: Any) -> NormalizedTask:
    from synth.tasks.adapt import normalize_task

    nt = normalize_task(task)
    if nt is None:
        # last-resort: keep the pipeline alive with an empty, judged task
        return NormalizedTask(prompt=str(task), answer_type="state", answer="")
    return nt


def synthesize_taskset(
    source: Any,
    *,
    env_name: str | None = None,
    tool_names: set[str] | None = None,
    use_llm: bool = True,
    judge_model: str = DEFAULT_JUDGE_MODEL,
    agent_model: str | None = None,
) -> SynthesizedTaskset:
    """Synthesize a taskset from ANY input: a ProjectSpec, raw JSON, a block list, or tasks."""
    tasks, env_n, tool_n, diagnostics = adapt_tasks(source)
    env_name = env_name or env_n or "env"
    tool_names = tool_names if tool_names is not None else tool_n

    if not tasks:
        diagnostics.append(Diagnostic(level="warn", code="suite.no_tasks", message="No task blocks found; nothing to grade."))
    if agent_model and judge_model == agent_model:
        diagnostics.append(Diagnostic(level="error", code="judge.same_as_agent",
                                      message=f"Judge model {judge_model!r} equals the agent model; pick a different judge_model."))

    scenarios: list[SynthesizedScenario] = []
    used: dict[str, int] = {}
    for i, task in enumerate(tasks):
        base = _slug(task.prompt, f"task_{i + 1}")
        if base in used:
            used[base] += 1
            base = f"{base}_{used[base]}"
        else:
            used[base] = 1
        scenarios.append(synthesize_scenario(
            task, env_name=env_name, fn_name=base, task_id=base,
            tool_names=tool_names, use_llm=use_llm, judge_model=judge_model,
        ))

    if len([s for s in scenarios for _ in s.calls]) == 1:
        diagnostics.append(Diagnostic(level="info", code="suite.single_task",
                                      message="Only one concrete task. RL needs spread — add tasks or parameters."))

    return SynthesizedTaskset(
        env_name=env_name,
        scenarios=scenarios,
        meta={"origins": sorted({s.origin for s in scenarios}), "count": len(scenarios)},
        diagnostics=diagnostics,
    )


def synthesize_from_json(raw: Any, *, use_llm: bool = True) -> SynthesizedTaskset:
    """End-to-end from arbitrary/versioned JSON. Alias of synthesize_taskset (which adapts any shape)."""
    return synthesize_taskset(raw, use_llm=use_llm)
