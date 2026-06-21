"""bench-ception v3 — builders build a full training env, a trainee is RL-trained
on each, then judged on the deployed golden SC-bench leaderboard.

Flow:  build (per builder) -> plan.json -> [manual review/approve] -> train
       -> eval trained + untrained baseline on the golden -> leaderboard.

Builders: claude-opus-4-8, gpt-5.5 (config.BUILDERS). Trainee: Qwen/Qwen3-8B.
Golden: the deployed `sc-bench` platform taskset. Training is GATED — `run_build`
only produces plans; nothing trains until `train_and_eval` is called on an
approved plan (the app surfaces the review gate).
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from .builder import _strip_fences
from .config import BUILDERS, GATEWAY_URL, GOLDEN_TASKSET, TRAINEE, load_hud_key

ROOT = Path(__file__).parent.parent
PLANS_DIR = ROOT / ".generated" / "v3_plans"

# --- build prompts (bake in the HUD task-quality doctrine) -----------------

BUILD_SYSTEM = """\
You are building a TRAINING environment (HUD v6) that teaches a small 8B model
supply-chain order-management reasoning, in the spirit of SupChain-Bench: a
three-tier system (Trade order -> Fulfillment order -> Warehouse order) where an
agent answers natural-language questions by chaining tool calls over a simulated
order database.

Use the v6 API EXACTLY (do NOT use any v5 idioms):
- `from hud import Environment`; `env = Environment(name="...")`.
- A task is `@env.template()` over an async generator:
      @env.template()
      async def my_task(arg: str = "x"):
          answer = yield "<prompt>"      # 1st yield: the prompt
          yield 1.0 if <correct> else 0.0  # 2nd yield: reward in [0,1]
  NEVER pass a positional name: `@env.template("name")` is WRONG; use
  `@env.template()` or `@env.template(id="my-id")`.
- Expose a tool with `@env.tool()` on a normal function (its type hints +
  docstring define the schema). NEVER `env.add_tool(...)` or `@env.scenario`.
- End with `tasks = [my_task(...), ...]` (instantiated rows).

Build a complete module:
- Expose supply-chain tools with `@env.tool()` over your OWN fabricated,
  self-consistent dataset embedded in the module (buyers, fulfillment/warehouse
  statuses, cancellation reasons, error logs, fake-shipping flags).
- CONTAMINATION GUARD: invent your OWN order ids and data. Do NOT reuse public
  SupChain-Bench ids (T1001, FO2001, WO3001, B4001, ...). This is a TRAINING
  ground, not the held-out test set.
- A PROPER TRAINING SET: at least 15 DIVERSE `@env.template` tasks, each
  requiring MULTI-STEP tool use (several tool calls + conditional logic). Vary
  failure modes (cancellations, errors, multi-hop lookups, warehouse status) and
  difficulty. Graders must reward CORRECT, tool-grounded answers on SUBSTANCE,
  not surface shape, so the cheapest non-working path scores low; and they must
  produce within-group reward spread (avoid all-0.0 or all-1.0 tasks).
- End with `tasks = [...]` (instantiated rows). Import cleanly; no network at
  import time; keep all data in the module.

Return ONLY the Python module — no prose, no markdown fences.
"""

CONFIG_SYSTEM = """\
You just built a HUD training environment. Propose ONE economical RL training run
to train Qwen3-8B on it via GRPO. This will be MANUALLY REVIEWED for cost before
it runs, so be conservative and justify the numbers.

Return ONLY a JSON object with these keys:
{"learning_rate": <float>, "steps": <int>, "group_size": <int>,
 "loss_fn": "ppo", "rollouts_per_step": <int>,
 "est_rollouts": <int = steps*rollouts_per_step>,
 "rationale": "<1-2 sentences: why these settings for this env>",
 "est_note": "<rough cost/time note for the reviewer>"}
"""

USER_PROMPT = (
    "Build the supply-chain training environment now. Domain: a three-tier order "
    "system (Trade -> Fulfillment -> Warehouse) with cancellations, errors, and "
    "warehouse status tracking, answered via tool calls."
)


def _chat(model: str, system: str, user: str, key: str, max_tokens: int = 8192) -> str:
    from openai import OpenAI

    client = OpenAI(base_url=GATEWAY_URL, api_key=key)
    resp = client.chat.completions.create(
        model=model,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        max_tokens=max_tokens,
    )
    return resp.choices[0].message.content or ""


def _validate(code: str) -> tuple[bool, int, str]:
    """The built module must load a non-empty `tasks` list."""
    import tempfile

    d = Path(tempfile.mkdtemp(prefix="v3build_"))
    (d / "env.py").write_text(code)
    try:
        from hud.eval import Taskset

        ts = Taskset.from_file(str(d / "env.py"))
        return (len(ts) > 0, len(ts), "")
    except Exception as e:  # noqa: BLE001
        return (False, 0, f"{type(e).__name__}: {e}")


def build_plan(builder: str, key: str | None = None) -> dict:
    """One builder: build the env + propose a training config. No training runs."""
    key = key or load_hud_key()
    # Reasoning builders (gpt-5.5) spend budget on reasoning; give the env build
    # plenty of room so the code isn't cut off (finish_reason=length -> empty).
    code = _strip_fences(_chat(builder, BUILD_SYSTEM, USER_PROMPT, key, max_tokens=32000))
    valid, n_tasks, err = _validate(code)

    # One-shot auto-repair: hand the load error back and ask for the fixed module.
    repaired = False
    if not valid:
        repair = (f"The module you returned failed to load with this error:\n{err}\n\n"
                  "Return the COMPLETE corrected module (only Python, no prose, no fences). "
                  "Previous module:\n\n" + code)
        code2 = _strip_fences(_chat(builder, BUILD_SYSTEM, repair, key, max_tokens=32000))
        v2, n2, e2 = _validate(code2)
        if v2:
            code, valid, n_tasks, err, repaired = code2, v2, n2, "", True
        else:
            err = f"{err} | after repair: {e2}"

    config, cfg_err = {}, ""
    try:
        raw = _chat(builder, CONFIG_SYSTEM, "Here is the environment you built:\n\n" + code, key, 1024)
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        config = json.loads(m.group(0)) if m else {}
    except Exception as e:  # noqa: BLE001
        cfg_err = f"{type(e).__name__}: {e}"

    PLANS_DIR.mkdir(parents=True, exist_ok=True)
    safe = builder.replace("/", "_")
    (PLANS_DIR / f"{safe}.env.py").write_text(code)
    plan = {
        "builder": builder, "valid": valid, "n_tasks": n_tasks, "repaired": repaired,
        "errors": [e for e in (err, cfg_err) if e],
        "training_config": config,
        "env_path": str(PLANS_DIR / f"{safe}.env.py"),
        "code_preview": code[:1200],
    }
    (PLANS_DIR / f"{safe}.plan.json").write_text(json.dumps(plan, indent=2))
    return plan


def run_build(builders: list[str] | None = None) -> dict:
    """Build a training env + config for every builder; write the review plan.

    Produces plans only — TRAINING IS GATED behind manual approval.
    """
    builders = builders or list(BUILDERS)
    plans = [build_plan(b) for b in builders]
    out = {"state": "review", "trainee": TRAINEE, "golden": GOLDEN_TASKSET, "plans": plans}
    PLANS_DIR.mkdir(parents=True, exist_ok=True)
    (PLANS_DIR / "plan.json").write_text(json.dumps(out, indent=2))
    return out
