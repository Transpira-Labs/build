"""
Schema-agnostic extraction front (LLM).

The UI's JSON shape changes across versions, so instead of parsing a fixed schema we
hand the *raw* JSON to Claude and ask it to normalize it into a canonical `ProjectSpec`
(env + tools as name/functionality + tasks). This is the layer that absorbs schema
drift; everything downstream (template match, codegen, smoke) works off the canonical
form.

Without an API key it falls back to `ProjectSpec.from_v1` so the pipeline still runs on
the known flat-block format.
"""

from __future__ import annotations

import json
from typing import Any

from synth.contracts import ProjectSpec
from synth.tools.gateway import complete_json

_PROJECT_SCHEMA = {
    "type": "object",
    "properties": {
        "env": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "snake_case environment name"},
                "description": {"type": "string"},
            },
            "required": ["name"],
            "additionalProperties": True,
        },
        "tools": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "snake_case identifier"},
                    "functionality": {
                        "type": "string",
                        "description": "one sentence: what the tool does",
                    },
                    "params": {
                        "type": "array",
                        "description": "explicit parameters if the source specifies them",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string"},
                                "type": {"enum": ["string", "integer", "number", "boolean"]},
                                "description": {"type": "string"},
                                "required": {"type": "boolean"},
                            },
                            "required": ["name", "type"],
                        },
                    },
                },
                "required": ["name", "functionality"],
                "additionalProperties": True,
            },
        },
        "tasks": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "prompt": {"type": "string"},
                    "answer_type": {
                        "type": "string",
                        "description": "'exact' for a literal answer, 'state' for a described goal",
                    },
                    "answer": {"type": "string"},
                    "args": {
                        "type": "object",
                        "description": "any extra task arguments/parameters, kept verbatim",
                        "additionalProperties": True,
                    },
                },
                "required": ["prompt"],
                "additionalProperties": True,
            },
        },
        "custom": {
            "type": "array",
            "description": "blocks that don't map to env/tool/task — keep their full content here",
            "items": {"type": "object", "additionalProperties": True},
        },
    },
    "required": ["env", "tools"],
}

_SYSTEM = """You normalize an arbitrary project definition into a canonical structure.
The input JSON's schema is UNKNOWN and changes between product versions — it may use
different key names, nest things, add extra fields, or include custom block types you have
not seen. Infer intent from meaning, never assume specific keys.

Map every block to the closest canonical concept:
- env: a snake_case `name` and short `description`.
- tools: anything the agent can DO/CALL. Each gets a snake_case `name` and a one-sentence
  `functionality`. If the source specifies parameters/arguments, list them under `params`.
- tasks: anything that sets a goal to accomplish. Each gets a `prompt`, an `answer_type`
  ("exact" for a literal answer, "state" for a described success condition), the `answer`,
  and any extra arguments under `args`.
- custom: if a block genuinely fits none of the above, put its FULL original content in
  `custom` — never discard information.

Preserve any extra fields you find by carrying them onto the matching tool/task. Invent
reasonable snake_case names when the source omits them. Call emit_project once."""


def extract_project(raw: Any, *, use_llm: bool = True) -> ProjectSpec:
    if use_llm:
        spec = _llm_extract(raw)
        if spec is not None:
            return spec
    data = raw if isinstance(raw, (dict, list)) else json.loads(raw)
    return ProjectSpec.from_v1(data)


def _llm_extract(raw: Any) -> ProjectSpec | None:
    blob = raw if isinstance(raw, str) else json.dumps(raw, indent=2)
    data = complete_json(
        system=_SYSTEM,
        user=f"Project definition JSON:\n{blob}",
        schema=_PROJECT_SCHEMA,
        fn_name="emit_project",
        fn_description="Emit the normalized project.",
    )
    if data is None:
        return None
    try:
        return ProjectSpec.model_validate(data)
    except Exception as exc:  # noqa: BLE001 - malformed LLM output → heuristic parser
        print(f"[tool-synth] LLM extraction was malformed ({exc!r}); using heuristic parser.")
        return None
