# RL Scratch — backend synthesizers

Turns the UI's flat **v1 JSON** (one env block, some tool blocks, some task blocks) into a
runnable, graded HUD environment. The pipeline:

```
v1 JSON ─▶ [1 validate&group] ─▶ ProjectSpec ─┬─▶ [2 tool synth]  ─▶ SynthesizedTool(s)
                                              └─▶ [3 tasks synth] ─▶ Scenario(s)
                                   ─▶ [4 compile+smoke] ─▶ env.py ─▶ HUD
                                   ─▶ [5 golden gate] ─▶ [6 baseline] ─▶ [7 train] ─▶ [8 registry]
```

This module owns the shared **contract** and **step 2 (tool synthesizer)**. Step 3 (tasks
synthesizer) lives under `synth/tasks/` and is built separately.

> **Schema-agnostic by design.** The UI's JSON shape changes between versions, so the entry
> point feeds the *raw* JSON to an LLM that normalizes it into a canonical `ProjectSpec`
> (`extract.py`). Neither synthesizer is coupled to a fixed schema. Run order: the **tool
> synthesizer runs first** (produces `tools.py` + `toolset.json`), then the tasks synthesizer.

## Schema tolerance

The input layer is built to survive *any* version of the UI's JSON — extra fields, extra task
arguments, new tool parameters, and **custom block types** that didn't exist when this was
written:

- The LLM extractor (`extract.py`) infers intent from meaning, maps custom blocks to the
  closest concept, and routes anything that fits nothing into `ProjectSpec.custom` — never
  dropping information.
- Every input block allows extra fields (`extra="allow"`), so unknown keys are preserved.
- `ToolBlock.params` / `TaskBlock.args` capture explicit parameters/arguments from richer
  schemas (and flow into the synthesized function signature).
- Unknown `answer_type` values are *coerced* to a valid regime, never rejected.
- The offline heuristic parser (`ProjectSpec.from_v1`) never raises on a missing key or an
  unknown/garbage block — it preserves what it can and keeps the rest in `custom`.

See `tests/test_schema_robustness.py`.

## Tools in HUD v6 (for step 4)

Tools are a **capability**, not the legacy `env.tool()` (v5, deprecated shim only). A
synthesized tool is a plain typed function with a docstring — exactly what FastMCP turns
into a tool schema. Step 4 builds `env.py` as: the tool defs + `TOOLS` (`assemble_module`),
then the wiring from `emit_mcp_server` — a `FastMCP` server registering `TOOLS`, served over
streamable-HTTP and published via `env.add_capability(Capability.mcp(url=".../mcp"))` in the
env's `@env.initialize`/`@env.shutdown` lifecycle. The agent's harness attaches its own tools
to that capability; risky (`needs_sandbox`) tools execute inside the HUD env container.

## The contract (`synth/contracts.py`) — shared, keep stable

**Input (v1 blocks, shared by every step):**
- `EnvBlock(name, description)`
- `ToolBlock(name, functionality)` — `functionality` is a plain-English sentence.
- `TaskBlock(prompt, answer_type∈{exact,state}, answer)` — `answerType` alias accepted.
- `ProjectSpec(env, tools, tasks)` with `ProjectSpec.from_v1(...)` accepting a grouped object
  or a flat block list.

**Tool synthesizer output (handoff to step 4):**
- `SynthesizedTool(name, description, params, source, origin, needs_sandbox, smoke)`
  - `source` — a self-contained `def <name>(...)` (with imports), ready to register.
  - `origin` — `"template:<key>"`, `"llm"`, or `"stub"`.
  - `needs_sandbox` — runs code / hits network / touches fs → execute **only** in HUD's sandbox.
  - `smoke: SmokeResult(status∈{passed,compiled,failed,skipped}, detail)`.
- `SynthesizedToolset(env_name, tools, meta)`.

## Step 2: how a tool is synthesized

`extract_project(raw_json)` (LLM) → canonical `ProjectSpec`, then `synthesize_tool(ToolBlock)`
per tool. The extraction absorbs schema drift; synthesis is two-tier:

1. **Template match** (`match.py` + `templates.py`) — reuse a hand-written, tested tool when
   the description fits. Library: `run_python`, `calculator`, `web_search`, `http_get`,
   `read_file`. Preferred because the code is already correct.
2. **LLM codegen** (`llm.py`) — otherwise Claude writes the function from the prose, inferring
   the signature. Only when an API key is configured.
3. **Safe stub** — last resort (no match, no key) so the pipeline always yields runnable code.

Every result is **compile-checked** (`smoke.py`) — we confirm the source compiles but do
**not** execute tools here. Real execution happens later inside HUD's sandbox. Tools that run
code, hit the network, or touch the filesystem are flagged `needs_sandbox`; LLM output whose
source *looks* risky is force-flagged even if the model said otherwise. (No smoke-run, no
golden gate — both are intentionally out of this pipeline.)

## Usage

```bash
# from backend/, with .venv active. Input JSON can be any version.
synth-tools examples/project_v1.json -o out/   # writes out/{project,toolset}.json + out/tools.py
synth-tools examples/project_v1.json --no-llm  # heuristic parse + templates + stubs (offline)
```

LLM access goes through the **HUD gateway** (`inference.hud.ai`, OpenAI-compatible) with a
single `HUD_API_KEY` — used for both schema extraction and codegen of unmatched tools. Set the
key with `hud set HUD_API_KEY=...` (→ `~/.hud/.env`), a project `.env`, or process env;
`gateway.py` loads them (precedence: process env > project `.env` > `~/.hud/.env`). Optional
`HUD_GATEWAY_URL` (default `https://inference.hud.ai/v1`), `SYNTH_MODEL` (default
`claude-sonnet-4-6`; any gateway-known id works). Without a key it falls back to the heuristic
parser + templates + stubs.

## Modules

- `contracts.py` — shared models (above).
- `tools/gateway.py` — HUD gateway client (OpenAI SDK → inference.hud.ai) + `.env` loader.
- `tools/extract.py` — LLM normalizes arbitrary JSON → canonical ProjectSpec.
- `tools/templates.py` — the tested template library.
- `tools/match.py` — description → template.
- `tools/llm.py` — Claude fallback (isolated; returns None without a key).
- `tools/smoke.py` — compile-check only; classifies risky tools for the sandbox.
- `tools/synthesizer.py` — `synthesize_tool` / `synthesize_toolset` (two-tier).
- `tools/assemble.py` — `assemble_module` (one importable `tools.py` + `TOOLS` list) and
  `emit_mcp_server` (the v6 FastMCP + `Capability.mcp` wiring block for step 4).
- `tools/cli.py` — the `synth-tools` command.
