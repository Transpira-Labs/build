"""bench-ception v3 training — the documented v6 client-here recipe.

Per https://docs.hud.ai/v6/core/training:
  agent = create_agent(slug, completion_kwargs={"extra_body": {"return_token_ids": True}})
  session = await Job.start(slug, group=G)
  loop: taskset.run(agent, runtime=..., job=session); batch = session.runs[start:];
        trainer.step(batch, learning_rate, group_size=G)

The env runs via a LOCAL runtime (agent loop + env client-here; model sampling is
remote on the gateway, which records the tokens). Hosted (off-box) execution was
flaky from this box (500s/DNS/websocket), so we use LocalRuntime with LOW
concurrency (the earlier local failures were 12+ concurrent subprocesses).

Each fork is trained on its OWN builder env; status -> .generated/training_status.json.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

from .backends.hud import _quiet_teardown
from .config import load_hud_key

ROOT = Path(__file__).parent.parent
PLANS = ROOT / ".generated" / "v3_plans"
STATUS = Path(os.environ["TRAIN2_STATUS"]) if os.environ.get("TRAIN2_STATUS") \
    else ROOT / ".generated" / "training_status.json"

# builder -> fork slug. Override via TRAIN2_FORKS (JSON) to train a different
# trainee (e.g. the Llama Gemma-equivalent) on the SAME builder envs.
FORKS = json.loads(os.environ["TRAIN2_FORKS"]) if os.environ.get("TRAIN2_FORKS") else {
    "gpt-5.5": "trained-on-gpt-5-5-supchain-env",
    "claude-opus-4-8": "trained-on-opus-4-8-env",
}


def _env_path(builder: str) -> str:
    return str(PLANS / f"{builder.replace('/', '_')}.env.py")


def _ok(r) -> bool:
    """A run is usable for training if it produced a reward. (Run.failed is a
    setter that needs an arg, not a predicate — don't call it.)"""
    return getattr(r, "reward", None) is not None


def _write(state: dict) -> None:
    STATUS.parent.mkdir(parents=True, exist_ok=True)
    STATUS.write_text(json.dumps(state, indent=2, default=str))


async def train_one(builder: str, slug: str, cfg: dict, state: dict,
                    tasks_per_step: int = 4, group_cap: int = 4,
                    max_concurrent: int = 2) -> None:
    from hud.agents import create_agent
    from hud.eval import Job, LocalRuntime, Taskset
    from hud.train import TrainingClient

    env_path = _env_path(builder)
    lr = float(cfg.get("learning_rate", 1e-5))
    steps = int(cfg.get("steps", 3))
    group = min(int(cfg.get("group_size", 4)), group_cap)  # bound for tractability
    loss = cfg.get("loss_fn", "ppo")

    full = Taskset.from_file(env_path)
    ts = Taskset(slug, list(full)[:tasks_per_step]) if tasks_per_step else full

    agent = create_agent(slug, completion_kwargs={"extra_body": {"return_token_ids": True}})
    trainer = TrainingClient(slug)
    session = await Job.start(slug, group=group)

    state[builder] = {"slug": slug, "builder": builder, "state": "training",
                      "total_steps": steps, "group": group, "tasks_per_step": tasks_per_step,
                      "done_steps": 0, "history": []}
    _write(state)

    for step in range(steps):
        start = len(session.runs)
        usable: list = []
        for attempt in range(6):
            try:
                await ts.run(agent, runtime=LocalRuntime(env_path), job=session,
                             group=group, max_concurrent=max_concurrent)
                batch = session.runs[start:]
                usable = [r for r in batch if _ok(r)]
            except Exception as e:  # noqa: BLE001
                state[builder]["last_error"] = f"step {step+1} attempt {attempt+1}: {type(e).__name__}: {e}"
                _write(state)
            if usable:
                break
            await asyncio.sleep(30)
        if not usable:
            raise RuntimeError(f"step {step+1}: no usable rollouts after retries")

        rewards = [getattr(r, "reward", None) for r in usable]
        await trainer.step(usable, learning_rate=lr, group_size=group, loss_fn=loss)
        ckpts = await trainer.checkpoints()
        last = ckpts[-1] if ckpts else None
        state[builder]["history"].append({
            "step": step + 1, "n_rollouts": len(usable),
            "batch_rewards": [round(x, 3) for x in rewards if x is not None],
            "ckpt_mean_reward": getattr(last, "mean_reward", None),
            "ckpt_reward_std": (getattr(last, "metrics", {}) or {}).get("reward_std"),
        })
        state[builder]["done_steps"] = step + 1
        _write(state)

    state[builder]["state"] = "trained"
    _write(state)


async def _main(solo: str | None, steps_cap: int | None, tps: int, gcap: int, mc: int) -> dict:
    load_hud_key()
    targets = {solo: FORKS[solo]} if solo else dict(FORKS)
    plans = {b: json.loads((PLANS / f"{b.replace('/', '_')}.plan.json").read_text()) for b in targets}
    state: dict = {"mode": "train", "forks": FORKS}

    for b, slug in targets.items():  # sequential -> avoids local provisioning storms
        cfg = dict(plans[b]["training_config"])
        if steps_cap:
            cfg["steps"] = min(int(cfg.get("steps", steps_cap)), steps_cap)
        try:
            await train_one(b, slug, cfg, state, tasks_per_step=tps, group_cap=gcap, max_concurrent=mc)
        except Exception as e:  # noqa: BLE001
            state.setdefault(b, {})["state"] = "error"
            state[b]["error"] = f"{type(e).__name__}: {e}"
            _write(state)

    state["state"] = "done"
    _write(state)
    return state


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--solo", default=None)
    p.add_argument("--steps-cap", type=int, default=3)
    p.add_argument("--tasks-per-step", type=int, default=4)
    p.add_argument("--group-cap", type=int, default=4)
    p.add_argument("--max-concurrent", type=int, default=2)
    args = p.parse_args(argv)

    loop = asyncio.new_event_loop()
    loop.set_exception_handler(_quiet_teardown)
    try:
        state = loop.run_until_complete(_main(args.solo, args.steps_cap,
                                              args.tasks_per_step, args.group_cap, args.max_concurrent))
    finally:
        loop.run_until_complete(asyncio.sleep(0.2))
        loop.close()

    print("=== training done ===")
    for b in FORKS:
        s = state.get(b, {})
        print(f"{b} -> {s.get('slug')}: {s.get('state')} {s.get('done_steps')}/{s.get('total_steps')} "
              f"err={s.get('error','')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
