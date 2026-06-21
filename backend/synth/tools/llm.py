"""
LLM codegen for tools (tier 2) — used when no template matches.

Generates a single self-contained Python function from a tool's name + English
functionality, via the HUD gateway (see gateway.py). Returns None when no key is
configured or the call fails, so the caller degrades to a safe stub.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from synth.contracts import SynthesizedTool, ToolBlock, ToolParam
from synth.tools.gateway import complete_json

if TYPE_CHECKING:
    from synth.tools.world import World

_TOOL_SCHEMA = {
    "type": "object",
    "properties": {
        "description": {"type": "string", "description": "one-line description of the tool"},
        "params": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "valid python identifier"},
                    "type": {"enum": ["string", "integer", "number", "boolean"]},
                    "description": {"type": "string"},
                    "required": {"type": "boolean"},
                },
                "required": ["name", "type"],
            },
        },
        "needs_sandbox": {
            "type": "boolean",
            "description": "true if it runs code, hits the network, or touches the filesystem",
        },
        "source": {
            "type": "string",
            "description": (
                "a complete, self-contained python `def <tool_name>(...)` including any imports "
                "above it. The function name MUST equal the given tool name. Return a string."
            ),
        },
    },
    "required": ["description", "params", "needs_sandbox", "source"],
}

_SYSTEM = """You implement a single tool for a reinforcement-learning environment.
Given a tool name and an English description, write one self-contained Python function:
- The function name MUST equal the given tool name (a snake_case identifier).
- Infer parameters from the description; give each a type.
- Keep it dependency-light (standard library only) and return a string.
- Set needs_sandbox=true if it executes code, makes network calls, or reads/writes files.
- Include any imports directly above the def. Do not include comments or examples.
Call emit_tool exactly once."""

_SYSTEM_WORLD = """You implement a single tool for a reinforcement-learning environment.
The environment has ONE shared, frozen dataset in a module-global dict `WORLD`; tools must
read their answers from it so the data stays consistent and reproducible across rollouts.
Write one self-contained Python function:
- The function name MUST equal the given tool name (a snake_case identifier).
- Infer parameters from the description; give each a type.
- Read all returned data from `WORLD` (already defined above your function — do NOT redefine,
  reassign, or re-create it). Look entities up by the input id(s).
- NEVER use `random`, time, or any non-determinism. Unknown id -> an empty/default result.
- Keep it dependency-light (standard library only) and return a string. needs_sandbox=false.
- Include any imports directly above the def. Do not include comments or examples.
Call emit_tool exactly once."""


def llm_synthesize_tool(block: ToolBlock, world: "World | None" = None) -> SynthesizedTool | None:
    user = f"Tool name: {block.name}\nDescription: {block.functionality}"
    if block.params:  # richer schemas may declare explicit params — pass them as hints
        hints = "; ".join(f"{p.name}:{p.type}" + ("" if p.required else "?") for p in block.params)
        user += f"\nDeclared parameters: {hints}"
    if world is not None:
        from synth.tools.world import world_codegen_context
        user += world_codegen_context(world)
    data = complete_json(
        system=_SYSTEM_WORLD if world is not None else _SYSTEM,
        user=user,
        schema=_TOOL_SCHEMA,
        fn_name="emit_tool",
        fn_description="Emit the implemented tool.",
    )
    if data is None:
        return None
    try:
        return SynthesizedTool(
            name=block.name,
            description=data.get("description", block.functionality),
            params=[ToolParam.model_validate(p) for p in data.get("params", [])],
            source=data["source"],
            origin="llm",
            needs_sandbox=bool(data.get("needs_sandbox", True)),
        )
    except Exception as exc:  # noqa: BLE001
        print(f"[tool-synth] LLM tool for {block.name!r} was malformed ({exc!r}).")
        return None
