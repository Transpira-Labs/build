"""
World seed synthesizer — a shared, deterministic dataset for an env's tools.

Tools are otherwise generated in isolation, so each invents its own (often random) data;
the entity ids referenced in the tasks never line up and the correct answer is unobtainable
— tasks score ~0 ("dead"). This builds ONE consistent `WORLD` dict from the env + tools +
the tasks' own prompts/answers (which already state the expected facts), and the tool codegen
then reads from it. Frozen data → reproducible, *solvable* tasks.

Returns None when offline / no key (tools fall back to their standalone behavior, unchanged).
"""

from __future__ import annotations

import json
from pprint import pformat
from typing import Any

from pydantic import BaseModel, Field

from synth.contracts import ProjectSpec
from synth.tools.gateway import complete_json


class World(BaseModel):
    """A frozen seed dataset plus a one-line note describing its shape (for tool codegen)."""

    data: dict[str, Any] = Field(default_factory=dict)
    note: str = ""
    origin: str = "llm"


_WORLD_SCHEMA = {
    "type": "object",
    "properties": {
        "data": {
            "type": "object",
            "description": "the seed dataset: every entity id named in the tasks, wired consistently",
        },
        "note": {
            "type": "string",
            "description": "one or two sentences describing WORLD's shape, so tools know how to read it",
        },
    },
    "required": ["data", "note"],
}

_SYSTEM = """You build a small, internally-consistent dataset (a "world") for a tool-use
reinforcement-learning environment. The tools all read from this one shared dict.
Given the tools and the tasks (their prompts AND expected answers), produce a JSON object
`data` such that:
- every entity id named in a task prompt or answer EXISTS in the data,
- entities are wired together consistently (parent -> children, statuses, reasons, codes),
- an agent calling the tools can derive each task's expected answer from the data,
- all facts are frozen and deterministic — nothing random.
Keep it minimal but sufficient to make every task solvable. Also return `note`: a short
description of the data's shape so the tool implementations know how to look things up.
Call emit_world exactly once."""


def synthesize_world(spec: ProjectSpec, *, use_llm: bool = True) -> World | None:
    """Build the shared seed from the project. None when offline or there's nothing to anchor."""
    if not use_llm or not spec.tasks:
        return None
    tools_lines = "\n".join(f"- {t.name}: {t.functionality}" for t in spec.tools) or "(none)"
    tasks_lines = "\n".join(
        f"- prompt: {t.prompt}\n  expected: {t.answer}" for t in spec.tasks
    ) or "(none)"
    user = (
        f"Environment: {spec.env.name} — {spec.env.description}\n\n"
        f"Tools:\n{tools_lines}\n\n"
        f"Tasks (the data must make these answers derivable):\n{tasks_lines}"
    )
    data = complete_json(
        system=_SYSTEM, user=user, schema=_WORLD_SCHEMA,
        fn_name="emit_world", fn_description="Emit the seed world.",
    )
    if data is None:
        return None
    try:
        world = World(data=data.get("data", {}) or {}, note=data.get("note", ""))
    except Exception:  # noqa: BLE001 - a malformed world just disables seeding
        return None
    return world if world.data else None


def render_world(world: World) -> str:
    """The `WORLD = {...}` literal for env.py (valid python from the parsed JSON)."""
    body = pformat(world.data, indent=4, sort_dicts=True, width=100)
    note = f"# Shared, frozen seed read by the tools. {world.note}".strip()
    return f"{note}\nWORLD = {body}"


def world_codegen_context(world: World) -> str:
    """The instruction block appended to a tool's codegen prompt so it reads from WORLD."""
    return (
        "\n\nA module-global dict `WORLD` is already defined (do NOT redefine or reassign it). "
        "Read this tool's result from `WORLD` deterministically by looking up the input id(s); "
        "never use `random`; for an unknown id return an empty/default result.\n"
        f"WORLD shape: {world.note}\n"
        f"WORLD = {json.dumps(world.data, ensure_ascii=False)}"
    )
