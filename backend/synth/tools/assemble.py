"""
Assemble synthesized tools into one importable module (the step-4 handoff).

`assemble_module` concatenates each tool's source into a single `tools.py` (imports
hoisted, a `TOOLS` list at the end). `emit_mcp_server` renders the HUD **v6** wiring
that exposes those tools — a FastMCP server published as an `mcp` capability.

v6 note: tools are a *capability*, not `env.tool()` (that's the deprecated v5 shim).
The agent's harness attaches its own tools to the `mcp` capability; FastMCP derives
each tool's schema from the function's type hints + docstring.
"""

from __future__ import annotations

import textwrap

from synth.contracts import SynthesizedToolset


def _split_imports(source: str) -> tuple[list[str], str]:
    imports: list[str] = []
    body: list[str] = []
    for line in source.splitlines():
        stripped = line.strip()
        if (stripped.startswith("import ") or stripped.startswith("from ")) and not body:
            imports.append(stripped)
        else:
            body.append(line)
    return imports, "\n".join(body).strip("\n")


def assemble_module(toolset: SynthesizedToolset) -> str:
    all_imports: list[str] = []
    defs: list[str] = []
    for tool in toolset.tools:
        imports, body = _split_imports(tool.source)
        for imp in imports:
            if imp not in all_imports:
                all_imports.append(imp)
        defs.append(body)

    names = ", ".join(t.name for t in toolset.tools)
    header = (
        f'"""AUTO-GENERATED tools for env {toolset.env_name!r} '
        f"(RL Scratch tool synthesizer).\n\n"
        "Serve these as a HUD v6 `mcp` capability (FastMCP), not the legacy v5\n"
        "tool-registration API. Use synth.tools.assemble.emit_mcp_server() for the\n"
        "wiring, or: `server = FastMCP(...); [server.tool(fn) for fn in TOOLS]`.\n"
        'Tools flagged needs_sandbox run inside the HUD env sandbox.\n"""\n'
    )
    import_block = ("\n".join(sorted(all_imports)) + "\n\n\n") if all_imports else ""
    body_block = "\n\n\n".join(defs)
    return f"{header}\n{import_block}{body_block}\n\n\nTOOLS = [{names}]\n"


# import lines the mcp-capability block needs (hoisted to the top of env.py).
_MCP_IMPORTS: tuple[str, ...] = (
    "import asyncio",
    "import contextlib",
    "import socket",
    "from fastmcp import FastMCP",
    "from hud.capabilities import Capability",
)


def _mcp_body(server_name: str, capability_name: str) -> str:
    """The mcp-capability code (no imports). Assumes `env` and `TOOLS` exist above it.

    Binds an *ephemeral* port (not a fixed one): each rollout runs in a fresh
    subprocess, so two concurrent rollouts on one host would collide on a hardcoded
    port. We grab a free port, serve the FastMCP server on it, then publish that exact
    URL as the `mcp` capability inside the env's initialize/shutdown lifecycle.
    """
    return textwrap.dedent(
        f'''\
        # ── HUD v6 tool capability: serve the synthesized tools over MCP ──
        _tool_server = FastMCP(name="{server_name}")
        for _fn in TOOLS:
            _tool_server.tool(_fn)  # type hints + docstring become the tool schema

        _tool_task: "asyncio.Task | None" = None
        _tool_port: "int | None" = None


        def _free_tcp_port() -> int:
            """An OS-assigned free port, so parallel rollouts never collide on a fixed one."""
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as _sock:
                _sock.bind(("127.0.0.1", 0))
                return _sock.getsockname()[1]


        @env.initialize
        async def _start_tools():
            global _tool_task, _tool_port
            if _tool_task is None:
                _tool_port = _free_tcp_port()
                _tool_task = asyncio.create_task(
                    _tool_server.run_async(
                        transport="http", host="127.0.0.1", port=_tool_port, show_banner=False
                    )
                )
                await asyncio.sleep(1.0)  # let the server bind before publishing the capability
            env.add_capability(
                Capability.mcp(name="{capability_name}", url=f"http://127.0.0.1:{{_tool_port}}/mcp")
            )


        @env.shutdown
        async def _stop_tools():
            global _tool_task
            if _tool_task is not None:
                _tool_task.cancel()
                with contextlib.suppress(Exception):
                    await _tool_task
                _tool_task = None
        '''
    )


def mcp_capability_parts(
    toolset: SynthesizedToolset, *, capability_name: str = "tools"
) -> tuple[list[str], str]:
    """(import lines, body) for the v6 mcp tool capability — for the step-4 assembler.

    The body assumes the tool functions, a `TOOLS` list, and an `Environment` named
    `env` already exist in the module. Imports are returned separately so the assembler
    can hoist and dedupe them at the top of env.py.
    """
    return list(_MCP_IMPORTS), _mcp_body(f"{toolset.env_name}_tools", capability_name)


def emit_mcp_server(toolset: SynthesizedToolset, *, capability_name: str = "tools") -> str:
    """Standalone HUD v6 tool-capability block (imports + body) for one toolset.

    Serves the synthesized tools on a FastMCP server and publishes them as an `mcp`
    capability via the env's initialize/shutdown lifecycle, on an ephemeral port. The
    block assumes a `TOOLS` list and an `Environment` named `env` already exist; the
    synth package is NOT required at runtime — only `fastmcp` + `hud`.
    """
    imports, body = mcp_capability_parts(toolset, capability_name=capability_name)
    return "\n".join(imports) + "\n\n\n" + body
