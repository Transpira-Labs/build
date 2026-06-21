"""Tool synthesizer (pipeline step 2): arbitrary project JSON -> runnable Python tools."""

from synth.tools.assemble import assemble_module, emit_mcp_server, mcp_capability_parts
from synth.tools.extract import extract_project
from synth.tools.synthesizer import (
    synthesize_from_json,
    synthesize_tool,
    synthesize_toolset,
)

__all__ = [
    "assemble_module",
    "emit_mcp_server",
    "mcp_capability_parts",
    "extract_project",
    "synthesize_from_json",
    "synthesize_tool",
    "synthesize_toolset",
]
