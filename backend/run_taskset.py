"""
Bridge for the web app: run the *deployed* HUD taskset remotely and report the
HUD job id (early) plus final per-task scores. Reads a request object from
**stdin**:

    {"taskset": "<env_name>", "model": "claude-sonnet-4-6", "group": 3,
     "task_ids": ["slug-a", ...]}    # task_ids optional — omit to run all

It loads the taskset registered on HUD (`Taskset.from_api`), starts a `Job` so
its id is known up-front (the web app polls `/jobs/<id>/traces` for live
pending/running status — see job_traces.py), then runs every task group-times on
HUD's remote runtime. It prints exactly two things to **stdout**:

    @@HUDJOB <job_id>     # one early line, before the (slow) rollouts, so the
                          # web app can start polling traces immediately
    {<final JSON>}        # one JSON line at the end: per-task + mean reward

HUD SDK progress is redirected to **stderr** so stdout stays these two clean
lines for the Next.js `/api/run` route. Real rollouts cost HUD compute and need
HUD_API_KEY (the caller passes it through; HUD_API_URL is dropped upstream so the
SDK talks to the same beta backend the env deployed to).
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import sys
import traceback
from typing import Any, TextIO


def main() -> int:
    try:
        req = json.loads(sys.stdin.read())
    except json.JSONDecodeError as e:
        print(json.dumps({"ok": False, "error": f"invalid JSON on stdin: {e}"}))
        return 1

    name = (req.get("taskset") or "").strip()
    if not name:
        print(json.dumps({"ok": False, "error": "taskset name required"}))
        return 1
    model = (req.get("model") or "claude-sonnet-4-6").strip()
    try:
        group = max(1, int(req.get("group") or 3))
    except (TypeError, ValueError):
        group = 3
    task_ids = req.get("task_ids") if isinstance(req.get("task_ids"), list) else None

    from synth.compile.deploy import has_api_key

    if not has_api_key():
        print(json.dumps({"ok": False, "error": "no HUD_API_KEY in the environment"}))
        return 1

    real_stdout = sys.stdout
    try:
        # Keep stdout clean: the SDK prints rollout progress; send it to stderr.
        with contextlib.redirect_stdout(sys.stderr):
            result = asyncio.run(_run(name, model, group, task_ids, real_stdout))
    except Exception as e:  # noqa: BLE001 - surface any failure as JSON
        traceback.print_exc(file=sys.stderr)
        print(json.dumps({"ok": False, "error": str(e)}), file=real_stdout)
        return 1

    print(json.dumps(result), file=real_stdout)
    return 0 if result.get("ok") else 1


async def _run(
    name: str, model: str, group: int, task_ids: list[str] | None, out: TextIO
) -> dict[str, Any]:
    from hud import Job, Taskset
    from hud.agents import create_agent
    from hud.cli.utils.source import normalize_environment_name
    from hud.eval import HostedRuntime

    # The taskset is registered under HUD's slugified env name (dashes); normalize
    # so a stale underscore name from an older deploy still resolves.
    name = normalize_environment_name(name)
    taskset = Taskset.from_api(name)
    if task_ids:
        wanted = set(task_ids)
        kept = [t for slug, t in taskset.items() if slug in wanted]
        taskset = Taskset(taskset.name, kept)
    if not taskset or len(taskset) == 0:
        return {
            "ok": False,
            "error": f"taskset '{name}' has no tasks on HUD — rebuild to sync it first",
        }

    taskset_id = getattr(taskset, "id", None)
    # model_client=None defers the gateway client so the agent's identity can be
    # serialized for HOSTED execution: the whole rollout (agent + env + the LLM
    # judge grader) runs on the platform, which holds the gateway key — running
    # it with a leased env (HUDRuntime) instead fails grading with
    # "HUD_API_KEY is required for HUD gateway clients" (the leased env has no key).
    agent = create_agent(model, model_client=None, max_steps=50)
    session = await Job.start(model, group=group, taskset_id=taskset_id)

    # Hand the HUD job id to the web app immediately, before the slow rollouts,
    # so it can poll live trace status while this runs.
    print(f"@@HUDJOB {session.id}", file=out, flush=True)

    await taskset.run(agent, group=group, job=session, runtime=HostedRuntime())

    per_task: dict[str, float] = {}
    for slug, runs in session.results.items():
        rewards = [r.reward for r in runs if getattr(r, "reward", None) is not None]
        per_task[slug] = sum(rewards) / len(rewards) if rewards else 0.0
    mean = sum(per_task.values()) / len(per_task) if per_task else 0.0

    return {
        "ok": True,
        "job_id": session.id,
        "job_url": f"https://hud.ai/jobs/{session.id}",
        "model": model,
        "group": group,
        "task_count": len(per_task),
        "mean_reward": mean,
        "per_task": per_task,
    }


if __name__ == "__main__":
    from bridge_log import run
    run("run_taskset", main)
