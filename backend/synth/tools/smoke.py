"""
Compile-check a synthesized tool.

Per the current pipeline design we do NOT execute synthesized tools here — we only
confirm the source compiles. Real execution happens later, inside HUD's sandbox, for
any tool that runs code, hits the network, or touches the filesystem. `looks_risky`
classifies that so the synthesizer can set `needs_sandbox`.
"""

from __future__ import annotations

from synth.contracts import SmokeResult, SynthesizedTool

# Static tells that a tool must only ever run inside the sandbox.
_RISKY_TOKENS = (
    "subprocess", "os.system", "os.popen", "socket", "urllib", "requests",
    "httpx", "open(", "Path(", "shutil", "import os", "eval(", "exec(",
    "__import__", "pathlib",
)


def looks_risky(source: str) -> bool:
    """Heuristic: does this source do code-exec / network / filesystem work?"""
    return any(tok in source for tok in _RISKY_TOKENS)


def compile_check(tool: SynthesizedTool) -> SmokeResult:
    """Confirm the tool's source parses/compiles. No execution."""
    try:
        compile(tool.source, f"<tool:{tool.name}>", "exec")
    except SyntaxError as exc:
        return SmokeResult(status="failed", detail=f"syntax error: {exc}")
    detail = "compiled (sandbox required)" if tool.needs_sandbox else "compiled"
    return SmokeResult(status="compiled", detail=detail)
