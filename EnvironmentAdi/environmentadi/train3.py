"""10-step RL training with a CHECKPOINT and an SC-bench VALIDATION (group 5)
EVERY step. One fork per process (TrainingClient has no close(); a fresh process
keeps the session count down).

Models: realtrainedongpt-5-5 (GPT-5.5 env), realtrainedonclaudeopus4-8 (Opus env).
Validation set = the deployed `sc-bench` platform taskset, group_size 5 — each
validation is a real platform Job (-> leaderboard) AND a point on the curve.

    PYTHONPATH=. <hudpy> -m environmentadi.train3 --builder gpt-5.5
    PYTHONPATH=. <hudpy> -m environmentadi.train3 --builder claude-opus-4-8
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

from .backends.hud import _quiet_teardown
from .config import GOLDEN_TASKSET, load_hud_key

ROOT = Path(__file__).parent.parent
PLANS = ROOT / ".generated" / "v3_plans"
STATUS = ROOT / ".generated" / "train3_status.json"

FORKS = {
    "gpt-5.5": "realtrainedongpt-5-5",
    "claude-opus-4-8": "realtrainedonclaudeopus4-8",
}


def _env_path(b: str) -> str:
    return str(PLANS / f"{b.replace('/', '_')}.env.py")


def _read_status() -> dict:
    try:
        return json.loads(STATUS.read_text())
    except Exception:
        return {}


def _write(state: dict) -> None:
    STATUS.parent.mkdir(parents=True, exist_ok=True)
    STATUS.write_text(json.dumps(state, indent=2, default=str))


def _ok(r) -> bool:
    return getattr(r, "reward", None) is not None  # Run.failed is a setter, not a predicate


def _byname_agent(slug: str):
    """Serializable agent (model by name) for HostedRuntime validation."""
    from hud.types import AgentType

    at = AgentType.OPENAI_COMPATIBLE
    return at.cls(config=at.config_cls(model=slug))


async def _validate(slug: str, group: int) -> dict:
    """Eval the fork's current head on the sc-bench validation set (remote ->
    a real platform Job on the leaderboard)."""
    from hud.eval import HostedRuntime, Taskset

    ts = Taskset.from_api(GOLDEN_TASKSET)
    job = await ts.run(_byname_agent(slug), runtime=HostedRuntime(run_timeout=1800), group=group)
    jid = getattr(job, "id", None)
    return {"reward": getattr(job, "reward", None),
            "job_url": (f"https://hud.ai/jobs/{jid}") if jid else None}


async def train_fork(builder: str, slug: str, steps: int, lr: float,
                     train_group: int, tps: int, mc: int, val_group: int) -> None:
    from hud.agents import create_agent
    from hud.eval import Job, LocalRuntime, Taskset
    from hud.train import TrainingClient

    env_path = _env_path(builder)
    full = Taskset.from_file(env_path)
    train_ts = Taskset(slug, list(full)[:tps]) if tps else full
    agent = create_agent(slug, completion_kwargs={"extra_body": {"return_token_ids": True}})
    trainer = TrainingClient(slug)
    session = await Job.start(slug, group=train_group)

    state = _read_status()
    state[builder] = {"slug": slug, "builder": builder, "state": "training",
                      "validation_set": GOLDEN_TASKSET, "val_group": val_group,
                      "total_steps": steps, "done_steps": 0, "history": []}
    _write(state)

    for step in range(steps):
        start = len(session.runs)
        usable: list = []
        for attempt in range(6):
            try:
                await train_ts.run(agent, runtime=LocalRuntime(env_path), job=session,
                                   group=train_group, max_concurrent=mc)
                usable = [r for r in session.runs[start:] if _ok(r)]
            except Exception as e:  # noqa: BLE001
                state = _read_status()
                state[builder]["last_error"] = f"step {step+1} attempt {attempt+1}: {type(e).__name__}: {e}"
                _write(state)
            if usable:
                break
            await asyncio.sleep(30)
        if not usable:
            state = _read_status()
            state[builder]["state"] = "error"
            state[builder]["error"] = f"step {step+1}: no usable rollouts"
            _write(state)
            return

        train_rewards = [getattr(r, "reward", None) for r in usable]
        await trainer.step(usable, learning_rate=lr, group_size=train_group, loss_fn="ppo")  # checkpoint
        ckpts = await trainer.checkpoints()
        last = ckpts[-1] if ckpts else None

        val = {"reward": None}
        try:
            val = await _validate(slug, val_group)
        except Exception as e:  # noqa: BLE001
            val = {"reward": None, "error": f"{type(e).__name__}: {str(e)[:80]}"}

        state = _read_status()
        state[builder]["history"].append({
            "step": step + 1,
            "train_rewards": [round(x, 3) for x in train_rewards if x is not None],
            "ckpt_mean_reward": getattr(last, "mean_reward", None),
            "n_checkpoints": len(ckpts),
            "val_reward": val.get("reward"),
            "val_job": val.get("job_url"),
            "val_error": val.get("error"),
        })
        state[builder]["done_steps"] = step + 1
        _write(state)

    state = _read_status()
    state[builder]["state"] = "trained"
    _write(state)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--builder", required=True, choices=list(FORKS))
    p.add_argument("--steps", type=int, default=10)
    p.add_argument("--lr", type=float, default=1e-5)
    p.add_argument("--train-group", type=int, default=4)
    p.add_argument("--tasks-per-step", type=int, default=4)
    p.add_argument("--max-concurrent", type=int, default=2)
    p.add_argument("--val-group", type=int, default=5)
    args = p.parse_args(argv)
    load_hud_key()

    loop = asyncio.new_event_loop()
    loop.set_exception_handler(_quiet_teardown)
    try:
        loop.run_until_complete(train_fork(
            args.builder, FORKS[args.builder], args.steps, args.lr,
            args.train_group, args.tasks_per_step, args.max_concurrent, args.val_group))
    finally:
        loop.run_until_complete(asyncio.sleep(0.2))
        loop.close()

    s = _read_status().get(args.builder, {})
    print(f"{args.builder} -> {s.get('slug')}: {s.get('state')} {s.get('done_steps')}/{s.get('total_steps')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
