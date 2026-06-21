"""Drive bench-ception v3 training for BOTH forks in parallel, then eval the
trained models on the golden SC-bench taskset (group 5).

    # validate the loop works (1 step each):
    PYTHONPATH=. <hud-python> -m environmentadi.train_run --validate
    # full run with the builders' approved configs:
    PYTHONPATH=. <hud-python> -m environmentadi.train_run --eval-group 5

Writes .generated/training_status.json as it goes (per fork: step + mean_reward).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

from .backends.hud import _quiet_teardown
from .config import load_hud_key

ROOT = Path(__file__).parent.parent
PLANS = ROOT / ".generated" / "v3_plans"
STATUS = ROOT / ".generated" / "training_status.json"

# Builder -> the fork slug the user named.
FORKS = {
    "gpt-5.5": "trained-on-gpt-5-5-supchain-env",
    "claude-opus-4-8": "trained-on-opus-4-8-env",
}

# Builder -> the DEPLOYED platform taskset (training rolls out on HUD's infra,
# not locally) for that builder's training environment.
TASKSETS = {
    "gpt-5.5": "bc-train-gpt55",
    "claude-opus-4-8": "bc-train-opus",
}


def _write(state: dict) -> None:
    STATUS.parent.mkdir(parents=True, exist_ok=True)
    STATUS.write_text(json.dumps(state, indent=2, default=str))


def _hosted_agent(slug: str, train: bool):
    """A serializable agent (model by name, no built client) so HostedRuntime can
    ship it off-box; the hosted runner builds the gateway client. `train` records
    token ids/logprobs for the gradient step via serializable completion_kwargs."""
    from hud.types import AgentType

    at = AgentType.OPENAI_COMPATIBLE
    kw = {"model": slug}
    if train:
        kw["completion_kwargs"] = {"extra_body": {"return_token_ids": True}}
    return at.cls(config=at.config_cls(**kw))


async def _train_one(builder: str, slug: str, taskset_name: str, cfg: dict, state: dict) -> None:
    from hud.agents import create_agent
    from hud.eval import HostedRuntime, Job, Taskset
    from hud.train import TrainingClient

    lr = float(cfg.get("learning_rate", 1e-5))
    steps = int(cfg.get("steps", 5))
    group = int(cfg.get("group_size", 8))
    loss = cfg.get("loss_fn", "ppo")

    state[builder] = {"slug": slug, "builder": builder, "state": "training",
                      "taskset": taskset_name, "total_steps": steps, "done_steps": 0, "history": []}
    _write(state)

    # Platform taskset -> rollouts run on HUD's infra (not locally). Pass the
    # model by name (slug); the hosted runner builds the gateway client and, in a
    # training Job session, records token ids/logprobs for the gradient step.
    ts = Taskset.from_api(taskset_name)
    agent = _hosted_agent(slug, train=True)
    trainer = TrainingClient(slug)

    for step in range(steps):
        # HostedRuntime -> the whole rollout runs off-box on HUD's infra; read the
        # graded runs straight off the RETURNED job (the hosted results), not an
        # accumulating session (which doesn't fold hosted results back in).
        job = await ts.run(agent, runtime=HostedRuntime(), group=group)
        fresh = list(getattr(job, "runs", []) or [])
        trainable = [r for r in fresh if not getattr(r, "failed", False)]
        if not trainable:
            raise RuntimeError(f"step {step+1}: 0/{len(fresh)} rollouts usable")
        await trainer.step(trainable, learning_rate=lr, group_size=group, loss_fn=loss)
        ckpts = await trainer.checkpoints()
        last = ckpts[-1] if ckpts else None
        state[builder]["history"].append({
            "step": step + 1,
            "mean_reward": getattr(last, "mean_reward", None),
            "reward_std": (getattr(last, "metrics", {}) or {}).get("reward_std"),
        })
        state[builder]["done_steps"] = step + 1
        _write(state)

    state[builder]["state"] = "trained"
    _write(state)


async def _eval_golden(slug: str, group: int) -> dict:
    from hud.agents import create_agent
    from hud.eval import HostedRuntime, Taskset

    from .config import GOLDEN_TASKSET
    ts = Taskset.from_api(GOLDEN_TASKSET)
    job = await ts.run(_hosted_agent(slug, train=False), runtime=HostedRuntime(), group=group)
    jid = getattr(job, "id", None)
    return {"model": slug, "reward": getattr(job, "reward", None),
            "job_url": (f"https://hud.ai/jobs/{jid}") if jid else None}


async def _main(validate: bool, eval_group: int, solo: str | None = None,
                parallel: bool = True, steps_cap: int | None = None) -> dict:
    targets = {solo: FORKS[solo]} if solo else dict(FORKS)
    plans = {b: json.loads((PLANS / f"{b.replace('/', '_')}.plan.json").read_text()) for b in targets}
    state: dict = {"mode": "validate" if validate else "full", "eval_group": eval_group}

    async def one(b: str, slug: str):
        cfg = dict(plans[b]["training_config"])
        if validate:
            cfg["steps"] = 1
        elif steps_cap:
            cfg["steps"] = min(int(cfg.get("steps", steps_cap)), steps_cap)
        await _train_one(b, slug, TASKSETS[b], cfg, state)
        state[b]["golden"] = await _eval_golden(slug, eval_group)
        _write(state)

    if parallel and not solo:
        await asyncio.gather(*(one(b, slug) for b, slug in targets.items()))
    else:
        for b, slug in targets.items():
            await one(b, slug)
    state["state"] = "done"
    _write(state)
    return state


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--validate", action="store_true", help="1 step per fork (smoke test)")
    p.add_argument("--eval-group", type=int, default=5, help="golden eval rollouts per task")
    p.add_argument("--solo", default=None, help="train only this builder (e.g. gpt-5.5)")
    p.add_argument("--sequential", action="store_true", help="train forks one at a time")
    p.add_argument("--steps-cap", type=int, default=None, help="cap steps per fork (tractability)")
    args = p.parse_args(argv)
    load_hud_key()

    loop = asyncio.new_event_loop()
    loop.set_exception_handler(_quiet_teardown)
    try:
        state = loop.run_until_complete(_main(
            args.validate, args.eval_group, solo=args.solo,
            parallel=not args.sequential, steps_cap=args.steps_cap))
    finally:
        loop.run_until_complete(asyncio.sleep(0.2))
        loop.close()

    print("=== training run complete ===")
    for b in FORKS:
        s = state.get(b, {})
        g = s.get("golden", {})
        print(f"{b} -> {s.get('slug')}: {s.get('done_steps')}/{s.get('total_steps')} steps, "
              f"golden reward={g.get('reward')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
