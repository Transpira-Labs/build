"""
Schema-tolerance tests: the pipeline must survive arbitrary/versioned JSON —
extra fields, extra task args, unknown grading types, and custom block types.
"""

from __future__ import annotations

from synth.contracts import ProjectSpec, TaskBlock, ToolBlock
from synth.tools.synthesizer import synthesize_from_json


def test_blocks_preserve_unknown_extra_fields():
    tool = ToolBlock.model_validate(
        {"name": "t", "functionality": "do x", "color": "blue", "ui": {"x": 1}}
    )
    dumped = tool.model_dump()
    assert dumped["color"] == "blue" and dumped["ui"] == {"x": 1}


def test_unknown_answer_type_is_coerced_not_rejected():
    # judging-flavored custom type → state; anything else → exact (no crash either way)
    assert TaskBlock(prompt="p", answerType="rubric", answer="a").answer_type == "state"
    assert TaskBlock(prompt="p", answerType="regex_v2", answer="a").answer_type == "exact"
    assert TaskBlock(prompt="p", answerType="exact", answer="a").answer_type == "exact"


def test_task_extra_args_preserved():
    t = TaskBlock.model_validate(
        {"prompt": "p", "answer": "a", "args": {"seed": 7, "difficulty": "hard"}}
    )
    assert t.args == {"seed": 7, "difficulty": "hard"}


def test_custom_block_types_are_kept_not_dropped():
    spec = ProjectSpec.from_v1(
        [
            {"type": "env", "name": "demo"},
            {"type": "tool", "name": "calc", "functionality": "evaluate math"},
            {"type": "reward_shaper", "name": "shaper", "weights": [0.1, 0.9]},  # custom!
            {"type": "widget", "label": "totally new block"},  # custom, no name
        ]
    )
    assert [t.name for t in spec.tools] == ["calc"]
    kinds = {c.get("type") for c in spec.custom}
    assert kinds == {"reward_shaper", "widget"}


def test_from_v1_infers_kind_without_type_field():
    spec = ProjectSpec.from_v1(
        {
            "blocks": [
                {"name": "myenv", "description": "an env"},          # → env
                {"name": "fetch", "functionality": "fetch a url"},    # → tool
                {"prompt": "what is 2+2", "answer": "4"},             # → task
            ]
        }
    )
    assert spec.env.name == "myenv"
    assert spec.tools[0].name == "fetch"
    assert spec.tasks[0].prompt == "what is 2+2"


def test_from_v1_never_crashes_on_garbage():
    spec = ProjectSpec.from_v1(["not a dict", 42, {"weird": "block"}, None])
    assert isinstance(spec, ProjectSpec)
    assert spec.env.name == "env"  # safe default
    assert len(spec.custom) == 4


def test_duplicate_tool_names_do_not_crash():
    spec = ProjectSpec(
        env={"name": "demo"},
        tools=[
            ToolBlock(name="dup", functionality="first"),
            ToolBlock(name="dup", functionality="second"),
        ],
    )
    assert [t.name for t in spec.tools] == ["dup"]  # deduped, first wins


def test_explicit_params_flow_into_synthesized_stub():
    # A custom tool block with declared params (offline → stub) keeps the signature.
    raw = [
        {"type": "env", "name": "demo"},
        {
            "type": "tool",
            "name": "place_order",
            "functionality": "place an order for an item with a quantity",
            "params": [
                {"name": "item", "type": "string"},
                {"name": "quantity", "type": "integer"},
            ],
        },
    ]
    toolset = synthesize_from_json(raw, use_llm=False)
    tool = next(t for t in toolset.tools if t.name == "place_order")
    assert {p.name for p in tool.params} == {"item", "quantity"}
    assert "def place_order(item: str, quantity: int)" in tool.source
    compile(tool.source, tool.name, "exec")


def test_end_to_end_offline_with_custom_blocks():
    raw = [
        {"type": "env", "name": "shop"},
        {"type": "tool", "name": "calc", "functionality": "evaluate a math expression"},
        {"type": "fancy_new_block", "data": 123},  # must not break the run
    ]
    toolset = synthesize_from_json(raw, use_llm=False)
    assert toolset.env_name == "shop"
    assert any(t.name == "calc" for t in toolset.tools)
