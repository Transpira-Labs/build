# EnvironmentAdi — "bench-ception"

A benchmark that measures **how well a model turns a JSON spec into a working
[HUD](https://docs.hud.ai/v6/start) environment** — itself wrapped *as a HUD
environment*. A HUD environment that evaluates the act of building HUD
environments. Hence **bench-ception**.

## The idea

```
                       one rough spec.json
   ┌──────────────────┬──────────────────────┬───────────────────┐
  GPT (gpt-oss-120b)  Qwen (Qwen3-235B-Inst)  Sonnet 4.6   Claude Opus 4.8
  builds env          builds env              builds env   builds the GOLDEN env
        \                   |                     /
         probe / trainee (Qwen3-8B) is run on each built environment
         → score = how well the env runs & grades (Phase 1)
         → score = transfer of a trainee trained on it to the golden env (Phase 2)
```

It's a **HUD environment** (`environmentadi/benchception.py`): the *agent* is a
builder model, the *task prompt* is the spec, the agent returns a HUD env module,
and the *grader runs a probe model on that submitted env via a nested HUD eval*.

## Run it

```bash
# bench-ception across the builder roster + the golden author. Needs HUD_API_KEY
# and the hud SDK; run with an interpreter that has them:
PYTHONPATH=. ~/.local/share/uv/tools/hud-python/bin/python \
    -m environmentadi.run_benchception --include-golden

# tune the probe + averaging:
BENCHCEPTION_GROUP=5 PYTHONPATH=. ~/.local/share/uv/tools/hud-python/bin/python \
    -m environmentadi.run_benchception --probe gpt-4o-mini

# or as a plain HUD eval, one builder at a time:
hud eval environmentadi/benchception.py gpt-5.5 --gateway
```

Roster + roles live in `environmentadi/config.py`.

## Monitor dashboard

A self-contained dashboard to see everything end-to-end — the spec prompts, the
build system prompt, each builder's generated env, and every probe rollout's full
trace (task setup → agent turns → tool calls → final answer → grade) + reward +
a link to the hosted `hud.ai/trace/<id>`.

```bash
# 1. capture a run (instruments build -> probe-eval, writes dashboard/data.js):
PYTHONPATH=. ~/.local/share/uv/tools/hud-python/bin/python \
    -m environmentadi.capture --specs specs/supchain_bench.json specs/letter_count.json --group 2

# 2. open the dashboard (no server needed; data.js loads via <script>):
open dashboard/index.html
```

`environmentadi/capture.py` records the run; `dashboard/index.html` renders it
(pick a spec on the left → click a builder → expand any rollout to inspect the
full trace, with a "raw json" toggle per step).

## Status

- [x] **bench-ception as a full-nested HUD environment** — builder = agent,
      grader runs a probe on the submitted env. Verified end-to-end on the real
      roster (gpt-5.5, qwen3-coder, claude-sonnet-4-6) + Opus golden author.
- [x] Probe-rollout averaging (`BENCHCEPTION_GROUP`) to stabilize noisy scores.
- [ ] **Training (Phase 2)** — train the trainee on each built env, then judge it
      on the golden env. Blocked: see below.
- [ ] Golden-anchored scoring (compare each env's discrimination to the golden's).
- [ ] Richer / multi-task specs so envs differentiate more.

## Gateway + model-id gotchas (v6)

- **Use the beta gateway.** v6 (`hud-python` 0.6.6) serves inference at
  `https://inference.beta.hud.ai`. The old `https://inference.hud.ai` is the
  deprecated 0.5.x endpoint and returns a misleading
  *"Your Tinker SDK version is no longer supported"* 400 for open models — that's
  **not** an outage, just the wrong endpoint. `config.GATEWAY_URL` reads the SDK's
  `settings.hud_gateway_url` so it always matches.
- **Use fully-qualified ids** for the open/trainable models:
  `openai/gpt-oss-120b`, `Qwen/Qwen3-235B-A22B-Instruct-2507`, `Qwen/Qwen3-8B`,
  `meta-llama/Llama-3.2-3B`. The bare names (`gpt-oss-120b`) are *not supported*.
- `create_agent` (solver/probe) uses a stricter registry than raw chat (builder):
  e.g. `gpt-4.1` builds but can't run as an agent. Some models reject `temperature`.
- **Gemma 4** is `is_trainable: false` (can't be the Phase-2 trainee) — Qwen3-8B is.
- `hud rl run` was **removed** in v0.6.6; Phase-2 training is a hand-written loop on
  `hud.TrainingClient` (`forward_backward`/`optim_step`).

## Generated-env contract (learned by wiring it)

A built module must define `env = Environment(...)`, `@env.template()` tasks (two
yields: prompt, then reward 0–1), **and a module-level `tasks = [...]` list of
instantiated rows** — `Taskset.from_file` collects that list; without it the env
loads 0 tasks. Eval recipe: `Taskset.from_file` + `create_agent(model)` +
`taskset.run(agent, runtime=LocalRuntime(...))` → `Job.runs[*].reward`.

## Earlier iteration: cross-play tournament

Before the bench-ception pivot this was a cross-play matrix (each model builds an
env, each agent runs on the others' envs). That code still works and is tested:
`environmentadi/tournament.py`, `scoring.py`, `backends/` (mock + hud),
`python3 -m pytest tests`. Kept for reference and the offline mock harness.
