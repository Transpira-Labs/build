"""
Schema-robustness tests for the tasks compiler.

The UI's JSON shape changes between versions; tasks may gain parameters/arguments; and
custom block types may appear. These tests assert the compiler still produces valid,
runnable tasks — or degrades with a diagnostic — and never crashes, all offline.
"""

from __future__ import annotations

from synth.tasks.adapt import adapt_tasks, normalize_task
from synth.tasks.synthesizer import synthesize_taskset


def _valid(ts):
    """The rendered task half must always be importable python."""
    compile(ts.render(), "<env.py>", "exec")
    return ts


# ── renamed / unknown keys across versions ────────────────────────────────
def test_lenient_keys_are_resolved():
    nt = normalize_task({"instruction": "Sum 2 and 2.", "expected": "4", "grading": "literal"})
    assert nt is not None
    assert nt.prompt == "Sum 2 and 2." and nt.answer == "4" and nt.answer_type == "exact"


def test_unknown_answer_type_is_inferred_not_rejected():
    # missing type, numeric answer → exact
    assert normalize_task({"prompt": "p", "answer": "42"}).answer_type == "exact"
    # missing type, prose answer → state
    assert normalize_task({"prompt": "p", "answer": "a long descriptive sentence about success here ok"}).answer_type == "state"
    # weird custom grading word → coerced toward judge
    assert normalize_task({"prompt": "p", "answer": "x", "grader": "semantic-similarity"}).answer_type == "state"


def test_extra_fields_are_preserved_as_extras():
    nt = normalize_task({"prompt": "p", "answer": "x", "difficulty": "hard", "v2_meta": {"k": 1}})
    assert nt.extras.get("difficulty") == "hard" and "v2_meta" in nt.extras


# ── parameters in several shapes → template + expansion ───────────────────
def test_params_as_dict_of_value_lists_expand():
    ts = _valid(synthesize_taskset(
        [{"type": "task", "prompt": "How many {letter}s in {word}?", "answer": "3",
          "params": {"word": ["strawberry", "raspberry"], "letter": ["r"]}}],
        env_name="letters", use_llm=False,
    ))
    src = ts.render()
    assert "async def how_many_letter" in src
    # still a param f-string (now with the deterministic answer-format directive appended)
    assert "prompt = f\"How many {letter}s in {word}?" in src
    assert "ONLY the final number" in src  # numeric answer → numeric format directive
    # 2 words × 1 letter = 2 concrete tasks, args bound in the Taskset
    assert src.count("how_many_letter") >= 3  # def + 2 calls
    assert 'word="raspberry"' in src


def test_params_as_list_of_dicts_with_defaults():
    nt = normalize_task({
        "prompt": "Add {a} and {b}.", "answer": "{a}",
        "parameters": [{"name": "a", "values": [1, 2]}, {"name": "b", "default": 10, "type": "int"}],
    })
    assert {p.name for p in nt.params} == {"a", "b"}
    ts = _valid(synthesize_taskset([{"type": "task", **nt.model_dump()}], env_name="math", use_llm=False))
    assert "a: int" in ts.render() and "b: int = 10" in ts.render()


def test_taskblock_args_carry_params():
    # the shared TaskBlock now has `args`; adapt should read them
    nt = normalize_task({"prompt": "Echo {name}.", "answer": "{name}", "args": {"name": ["ada", "alan"]}})
    assert [p.name for p in nt.params] == ["name"]
    assert nt.params[0].values == ["ada", "alan"]


# ── custom / unknown block types ──────────────────────────────────────────
def test_custom_block_type_that_is_task_shaped_compiles():
    blocks = [
        {"type": "env", "name": "game"},
        {"type": "puzzle", "prompt": "Solve the maze and report the exit cell.", "answer": "C4"},  # custom type!
        {"type": "widget", "color": "blue"},  # genuinely not a task
    ]
    tasks, env, tools, diags = adapt_tasks(blocks)
    assert env == "game"
    assert len(tasks) == 1 and tasks[0].answer == "C4"          # the custom puzzle became a task
    assert any(d.code == "block.skipped_unknown" for d in diags)  # the widget was skipped, not fatal
    _valid(synthesize_taskset(blocks, use_llm=False))


def test_projectspec_custom_blocks_are_scanned():
    # grouped form where a task-shaped block landed in `custom`
    grouped = {"env": {"name": "e"}, "tools": [],
               "custom": [{"type": "mission", "prompt": "Find the flag.", "answer": "OK"}]}
    ts = _valid(synthesize_taskset(grouped, use_llm=False))
    assert ts.task_count == 1


# ── never crash on garbage ────────────────────────────────────────────────
def test_garbage_inputs_do_not_crash():
    for bad in (None, 42, "not json at all", [], {}, [1, 2, 3], {"weird": {"deeply": "nested"}}):
        ts = synthesize_taskset(bad, use_llm=False)
        compile(ts.render(), "<env.py>", "exec")  # always valid python, even if empty


def test_duplicate_param_combos_are_deduped():
    # repeated param values must not mint twin rows — the real Taskset rejects duplicate slugs
    ts = _valid(synthesize_taskset(
        [{"type": "task", "prompt": "echo {x}", "answer": "{x}", "params": {"x": [1, 1, 2, 2, 3]}}],
        env_name="e", use_llm=False,
    ))
    calls = ts.scenarios[0].calls
    assert calls == sorted(set(calls), key=calls.index)  # no duplicates
    assert len(calls) == 3  # {1, 2, 3}


def test_flat_v1_still_works():
    flat = [
        {"type": "env", "name": "research_agent"},
        {"type": "task", "prompt": "What is 17 * 23?", "answerType": "exact", "answer": "391"},
    ]
    ts = _valid(synthesize_taskset(flat, use_llm=False))
    assert ts.env_name == "research_agent"
    assert "numeric_match(answer, 391.0)" in ts.render()
