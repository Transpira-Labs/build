"""bench-ception v3 training + golden eval + leaderboard.

Per the HUD v6 training recipe (see the hud-environment-builder skill):
  fork a trainable model -> roll out grouped episodes in the builder's env with
  return_token_ids -> trainer.step(runs, lr, group_size) -> repeat -> the slug's
  head holds the trained weights. Then eval the slug on the deployed golden
  `sc-bench` taskset for the leaderboard.

TRAINING SPENDS REAL GPU CREDITS — `train_and_eval` is only invoked on an
approved plan (the app's review gate). `eval_on_golden` (used for the untrained
baseline + trained models) is cheap and safe to run anytime.
"""

from __future__ import annotations

import asyncio
import json
import subprocess

from .config import GOLDEN_TASKSET, TRAINEE, load_hud_key

HUD_JOB_URL = "https://hud.ai/jobs/"


# --- golden eval (leaderboard row) -----------------------------------------

async def _eval(model: str, group: int) -> dict:
    from hud.agents import create_agent
    from hud.eval import Taskset

    ts = Taskset.from_api(GOLDEN_TASKSET)  # the deployed platform taskset
    job = await ts.run(create_agent(model), group=group)
    job_id = getattr(job, "id", None)
    return {
        "model": model,
        "reward": getattr(job, "reward", None),
        "n_runs": len(getattr(job, "runs", []) or []),
        "job_url": (HUD_JOB_URL + job_id) if job_id else None,
    }


def eval_on_golden(model: str, group: int = 1) -> dict:
    """Evaluate a model on the golden SC-bench taskset; returns a leaderboard row."""
    load_hud_key()
    return asyncio.run(_eval(model, group))


def leaderboard(models: list[str], group: int = 1) -> list[dict]:
    """Score each model on the golden; sort high to low. Include the untrained
    trainee as the baseline row."""
    rows = [eval_on_golden(m, group) for m in models]
    rows.sort(key=lambda r: (r["reward"] is not None, r["reward"] or 0.0), reverse=True)
    return rows


# --- fork + train (GATED) --------------------------------------------------

def fork_trainee(builder: str, base: str | None = None) -> str:
    """Create a team-owned trainable model from the trainee base. Returns the slug."""
    base = base or TRAINEE
    name = f"bc-{builder.replace('/', '-').replace('.', '-')}"
    out = subprocess.run(
        ["hud", "models", "fork", base, "--name", name, "--json"],
        capture_output=True, text=True,
    )
    try:
        data = json.loads(out.stdout)
        return data.get("slug") or data.get("model_name") or data.get("id") or name
    except Exception:
        return name  # fall back to the requested name


async def _train(env_path: str, slug: str, cfg: dict) -> dict:
    from hud.agents import create_agent
    from hud.eval import Job, LocalRuntime, Taskset
    from hud.train import TrainingClient

    lr = float(cfg.get("learning_rate", 1e-5))
    steps = int(cfg.get("steps", 5))
    group = int(cfg.get("group_size", 8))
    loss_fn = cfg.get("loss_fn", "ppo")

    ts = Taskset.from_file(env_path)
    agent = create_agent(slug, completion_kwargs={"extra_body": {"return_token_ids": True}})
    trainer = TrainingClient(slug)
    session = await Job.start(slug, group=group)

    history = []
    for step in range(steps):
        start = len(session.runs)
        await ts.run(agent, runtime=LocalRuntime(env_path), job=session, group=group)
        await trainer.step(session.runs[start:], learning_rate=lr, group_size=group, loss_fn=loss_fn)
        ckpts = await trainer.checkpoints()
        last = ckpts[-1] if ckpts else None
        history.append({
            "step": step + 1,
            "mean_reward": getattr(last, "mean_reward", None),
            "reward_std": (getattr(last, "metrics", {}) or {}).get("reward_std"),
        })
    return {"slug": slug, "steps": steps, "history": history}


def train_and_eval(plan: dict, group: int = 1) -> dict:
    """GATED: fork the trainee, RL-train on this builder's env, then eval the
    trained model on the golden. Only call on an approved plan."""
    load_hud_key()
    builder = plan["builder"]
    slug = fork_trainee(builder)
    train_result = asyncio.run(_train(plan["env_path"], slug, plan.get("training_config", {})))
    trained_row = eval_on_golden(slug, group)
    return {"builder": builder, "trained_slug": slug,
            "training": train_result, "golden": trained_row}
