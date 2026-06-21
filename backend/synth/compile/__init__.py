"""Pipeline step 4 (compile): stitch the synthesized tools + tasks into one HUD v6 env.py.

Inputs are the two handoffs — a `SynthesizedToolset` (step 2) and a `SynthesizedTaskset`
(step 3) — plus the env's name/description. Output is a single, importable `env.py`:

    docstring → imports → tool defs + TOOLS → Environment → mcp capability → tasks + Taskset

Per the current design this step **only compiles** the result (a syntax/AST check); it does
not boot the env or run a smoke eval. A version is pinned (content hash) for traceability.
"""

from synth.compile.assemble_env import CompiledEnv, assemble_env, compile_env

__all__ = ["CompiledEnv", "assemble_env", "compile_env"]
