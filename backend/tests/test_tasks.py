"""
Tests for the LLM-driven tasks synthesizer.

Most run fully offline (use_llm=False → deterministic planning). The LLM path is
exercised by monkeypatching the planner, so no API key or network is needed. Covers:
the grading-mode split, the inline smoke check (honors the user's own answer), the
LLM grader → deterministic fallback, a valid full render, and the diagnostics.
"""

from __future__ import annotations

import synth.tasks.synthesizer as S
from synth.contracts import EnvBlock, ProjectSpec, TaskBlock, ToolBlock
from synth.tasks import (
    ScenarioPlan,
    score_exact,
    synthesize_scenario,
    synthesize_taskset,
)
from synth.tasks.spec import GRADING_MODE, grading_mode


def _exact(prompt, answer):
    return TaskBlock(prompt=prompt, answerType="exact", answer=answer)


def _state(prompt, answer):
    return TaskBlock(prompt=prompt, answerType="state", answer=answer)


def _project(tasks, tools=(), name="demo"):
    return ProjectSpec(
        env=EnvBlock(name=name, description=""),
        tools=[ToolBlock(name=n, functionality=f) for n, f in tools],
        tasks=tasks,
    )


# ── the distinction itself ────────────────────────────────────────────────
def test_answer_type_maps_to_grading_mode():
    assert GRADING_MODE == {"exact": "deterministic", "state": "llm_judge"}
    assert grading_mode(_exact("p", "x")) == "deterministic"
    assert grading_mode(_state("p", "x")) == "llm_judge"


# ── offline deterministic synthesis (no LLM) ──────────────────────────────
def test_offline_exact_is_deterministic_state_is_judge():
    ts = synthesize_taskset(
        _project([
            _exact("How much is Opus?", "1024"),
            _exact("Capital of France?", "Paris"),
            _state("Summarize the docs.", "A faithful, concise summary of the page."),
        ]),
        use_llm=False,
    )
    assert ts.meta["origins"] == ["deterministic"]
    by_mode = [s.grading_mode for s in ts.scenarios]
    assert by_mode == ["deterministic", "deterministic", "llm_judge"]

    src = ts.render()
    assert "yield numeric_match(answer, 1024.0)" in src
    assert 'max(exact_match(answer, "Paris"), contains(answer, "Paris"))' in src
    assert "await LLMJudgeGrader.grade(" in src and "question=prompt," in src and "model=" in src
    assert "from hud import Taskset" in src and "@env.template(id=" in src
    compile(src, "<env.py>", "exec")  # the whole task half is valid python


def test_smoke_passes_for_deterministic_compiles_for_judge():
    ts = synthesize_taskset(
        _project([_exact("Capital of France?", "Paris"), _state("Write a poem.", "It rhymes and scans.")]),
        use_llm=False,
    )
    det, judge = ts.scenarios
    assert det.smoke.status == "passed"      # ran the grader, honored "Paris"
    assert judge.smoke.status == "compiled"  # judge grader: live check deferred
    assert not ts.has_errors


# ── the smoke check is a real golden check ────────────────────────────────
def test_score_exact_runtime_twin():
    assert score_exact("1024.0", "1024") == 1.0
    assert score_exact("The capital is Paris.", "Paris") == 1.0
    assert score_exact("London", "Paris") == 0.0


# ── LLM path (monkeypatched planner — no network) ─────────────────────────
def test_llm_plan_is_used_when_available(monkeypatch):
    def fake_plan(task, env_name, tool_names):
        return ScenarioPlan(prompt="Compute it.", mode="deterministic", expected="391", match="numeric")

    monkeypatch.setattr(S, "llm_plan_scenario", fake_plan)
    scn = synthesize_scenario(_exact("What is 17 * 23?", "391"), env_name="e",
                              fn_name="mul", task_id="mul", use_llm=True)
    assert scn.origin == "llm"
    # the planner's prompt is kept, with the deterministic answer-format directive appended
    assert scn.prompt.startswith("Compute it.")
    assert "ONLY the final number" in scn.prompt
    assert scn.grading_mode == "deterministic"
    assert scn.smoke.status == "passed"


def test_state_task_is_never_downgraded_to_deterministic(monkeypatch):
    # The planner over-eagerly picks deterministic when a literal ("B") is embedded in a
    # prose rubric. An author-chosen "state" task must stay llm_judge regardless — else it
    # mis-grades correct work and saturates on the literal.
    def det_plan(task, env_name, tool_names):
        return ScenarioPlan(prompt="Pick the best option and justify it.", mode="deterministic", expected="B")

    monkeypatch.setattr(S, "llm_plan_scenario", det_plan)
    scn = synthesize_scenario(
        _state("Which option is best, and why?", "Chooses B. Justifies it with sound reasoning."),
        env_name="e", fn_name="pick", task_id="pick", use_llm=True,
    )
    assert scn.grading_mode == "llm_judge"
    assert "await LLMJudgeGrader.grade(" in scn.source
    # and it does NOT raise the deterministic open-ended warning
    assert not any(d.code == "exact.looks_open_ended" for d in scn.diagnostics)


def test_llm_bad_grader_falls_back_to_deterministic(monkeypatch):
    # the LLM picks the wrong expected value; smoke against the user's real answer fails
    def bad_plan(task, env_name, tool_names):
        return ScenarioPlan(prompt=task.prompt, mode="deterministic", expected="WRONG")

    monkeypatch.setattr(S, "llm_plan_scenario", bad_plan)
    scn = synthesize_scenario(_exact("Capital of France?", "Paris"), env_name="e",
                              fn_name="cap", task_id="cap", use_llm=True)
    assert scn.origin == "deterministic"  # fell back
    assert scn.smoke.status == "passed"   # the fallback honors "Paris"
    assert any(d.code == "llm.grader_rejected" for d in scn.diagnostics)
    assert 'contains(answer, "Paris")' in scn.source


# ── diagnostics ───────────────────────────────────────────────────────────
def test_judge_must_differ_from_agent():
    ts = synthesize_taskset(_project([_state("p", "good output")]), use_llm=False,
                            judge_model="claude-opus-4-8", agent_model="claude-opus-4-8")
    assert any(d.code == "judge.same_as_agent" and d.level == "error" for d in ts.all_diagnostics)
    assert ts.has_errors


def test_exact_that_looks_open_ended_is_flagged():
    long_answer = "The function should validate input, then persist it, and finally return a receipt."
    ts = synthesize_taskset(_project([_exact("Build it.", long_answer)]), use_llm=False)
    assert any(d.code == "exact.looks_open_ended" for d in ts.all_diagnostics)


def test_duplicate_prompts_unique_names_and_empty_answer_error():
    ts = synthesize_taskset(_project([_exact("do the thing", "1"), _exact("do the thing", "")]), use_llm=False)
    src = ts.render()
    assert "async def do_the_thing()" in src and "async def do_the_thing_2()" in src
    assert any(d.code == "task.empty_answer" and d.level == "error" for d in ts.all_diagnostics)


def test_tool_cross_check_and_single_task_hint():
    ts = synthesize_taskset(
        _project([_exact("Do something vague.", "ok")], tools=[("add_note", "adds a note")], name="notes"),
        use_llm=False,
    )
    assert ts.env_name == "notes"
    assert any(d.code == "task.no_tool_reference" for d in ts.all_diagnostics)
    assert any(d.code == "suite.single_task" for d in ts.all_diagnostics)


# ── deterministic answer-format directive (scalable grading reliability) ────
def test_exact_prompts_get_an_answer_format_directive():
    ts = synthesize_taskset(
        _project([
            _exact("Compute 144 / 12.", "12"),                  # numeric
            _exact("What is the capital of France?", "Paris"),  # text
            _state("Summarize the page.", "A faithful summary."),  # judge — must be left alone
        ]),
        use_llm=False,
    )
    num, txt, judge = ts.scenarios
    assert "ONLY the final number" in num.prompt and num.prompt.startswith("Compute 144 / 12.")
    assert "ONLY the exact answer" in txt.prompt
    # state/judge prompts are NOT constrained — the judge absorbs phrasing
    assert "Reply with ONLY" not in judge.prompt


def test_directive_not_duplicated_when_prompt_already_constrains():
    from synth.tasks.grade import with_answer_format
    already = "What is 2+2? Reply with only the number."
    assert with_answer_format(already, "4", "numeric") == already
