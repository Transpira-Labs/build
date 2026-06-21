"""
HTTP service that runs the synth deploy/eval pipeline as async jobs, so the
Vercel app can trigger deploys/evals remotely (deploys/evals take minutes — far
past Vercel's 300s function cap — so they run as background jobs the client
polls).

It's a thin async wrapper around the existing CLIs (`deploy_one.py`,
`eval_one.py`): a request starts a job in a thread pool and returns a `job_id`;
`GET /jobs/{id}` returns status + result. No local Docker needed — `hud deploy`
uploads a build context and HUD builds the image remotely.

Auth: if SYNTH_API_SECRET is set, every request must send a matching
`X-Synth-Secret` header. HUD_API_KEY must be set in the service environment;
HUD_API_URL is dropped before invoking the pipeline (the hud CLI/SDK use their
own beta default — platform's api.hud.ai 404s the deploy endpoints).

Run:  uvicorn server:app --host 0.0.0.0 --port $PORT
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

HERE = Path(__file__).parent
PYTHON = sys.executable  # the interpreter running uvicorn (has the synth pkg + hud CLI)
SECRET = os.environ.get("SYNTH_API_SECRET")

_pool = ThreadPoolExecutor(max_workers=int(os.environ.get("SYNTH_MAX_JOBS", "4")))
_jobs: dict[str, dict[str, Any]] = {}

app = FastAPI(title="synth backend")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # the Vercel route calls this server-to-server
    allow_methods=["*"],
    allow_headers=["*"],
)


def _check(secret: str | None) -> None:
    if SECRET and secret != SECRET:
        raise HTTPException(status_code=401, detail="invalid or missing X-Synth-Secret")


def _run_script(script: str, stdin_obj: Any, args: list[str]) -> dict[str, Any]:
    """Run one of the pipeline CLIs, feeding stdin_obj as JSON; parse its JSON line."""
    env = dict(os.environ)
    env.pop("HUD_API_URL", None)  # let the hud CLI/SDK use their beta default
    proc = subprocess.run(
        [PYTHON, str(HERE / script), *args],
        input=json.dumps(stdin_obj),
        capture_output=True,
        text=True,
        cwd=str(HERE),
        env=env,
    )
    line = ""
    for ln in reversed(proc.stdout.strip().splitlines()):
        if ln.strip():
            line = ln
            break
    try:
        result = json.loads(line)
    except json.JSONDecodeError:
        result = {"ok": False, "error": "backend returned no JSON", "stdoutTail": proc.stdout[-2000:]}
    result["logTail"] = proc.stderr[-6000:]
    return result


def _start(script: str, stdin_obj: Any, args: list[str]) -> str:
    job_id = uuid.uuid4().hex
    _jobs[job_id] = {"status": "running", "result": None}

    def work() -> None:
        try:
            _jobs[job_id]["result"] = _run_script(script, stdin_obj, args)
            _jobs[job_id]["status"] = "done"
        except Exception as e:  # noqa: BLE001 - report as a failed job, never crash the pool
            _jobs[job_id]["result"] = {"ok": False, "error": str(e)}
            _jobs[job_id]["status"] = "error"

    _pool.submit(work)
    return job_id


class DeployReq(BaseModel):
    blocks: list[Any]
    dryRun: bool = False
    noLlm: bool = False


class EvalReq(BaseModel):
    blocks: list[Any] | None = None
    taskset: str | None = None
    models: list[str] | None = None
    group: int | None = None
    dryRun: bool = False


class RunReq(BaseModel):
    taskset: str
    model: str | None = None
    group: int | None = None
    task_ids: list[str] | None = None


class JobTracesReq(BaseModel):
    job_id: str


class SyncTasksReq(BaseModel):
    blocks: list[Any]
    env_name: str | None = None


class TrainReq(BaseModel):
    blocks: list[Any] | None = None
    taskset: str | None = None
    name: str | None = None
    base: str | None = None
    model: str | None = None
    steps: int | None = None
    group: int | None = None
    mode: str | None = None
    baseline: dict[str, Any] | None = None
    fork: bool | None = None
    dryRun: bool = False


@app.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True, "has_key": bool(os.environ.get("HUD_API_KEY"))}


@app.post("/deploy")
def deploy(req: DeployReq, x_synth_secret: str | None = Header(default=None)) -> dict[str, str]:
    _check(x_synth_secret)
    if not req.blocks:
        raise HTTPException(status_code=400, detail="blocks[] required")
    args: list[str] = []
    if req.dryRun:
        args.append("--dry-run")
    if req.noLlm:
        args.append("--no-llm")
    # deploy_one.py reads the raw blocks array on stdin.
    return {"job_id": _start("deploy_one.py", req.blocks, args)}


@app.post("/eval")
def eval_(req: EvalReq, x_synth_secret: str | None = Header(default=None)) -> dict[str, str]:
    _check(x_synth_secret)
    args = ["--dry-run"] if req.dryRun else []
    payload = {
        "blocks": req.blocks,
        "taskset": req.taskset,
        "models": req.models,
        "group": req.group,
    }
    return {"job_id": _start("eval_one.py", payload, args)}


@app.post("/train")
def train(req: TrainReq, x_synth_secret: str | None = Header(default=None)) -> dict[str, str]:
    _check(x_synth_secret)
    if not req.blocks and not req.taskset:
        raise HTTPException(status_code=400, detail="blocks[] or taskset required")
    args = ["--dry-run"] if req.dryRun else []
    payload = {
        "blocks": req.blocks,
        "taskset": req.taskset,
        "name": req.name,
        "base": req.base,
        "model": req.model,
        "steps": req.steps,
        "group": req.group,
        "mode": req.mode,
        "baseline": req.baseline,
        "fork": req.fork,
    }
    return {"job_id": _start("train_one.py", payload, args)}


@app.post("/run")
def run(req: RunReq, x_synth_secret: str | None = Header(default=None)) -> dict[str, str]:
    _check(x_synth_secret)
    if not req.taskset:
        raise HTTPException(status_code=400, detail="taskset required")
    payload = {
        "taskset": req.taskset,
        "model": req.model,
        "group": req.group,
        "task_ids": req.task_ids,
    }
    return {"job_id": _start("run_taskset.py", payload, [])}


@app.post("/job-traces")
def job_traces(req: JobTracesReq, x_synth_secret: str | None = Header(default=None)) -> dict[str, Any]:
    _check(x_synth_secret)
    return _run_script("job_traces.py", {"job_id": req.job_id}, [])


@app.post("/sync-tasks")
def sync_tasks(req: SyncTasksReq, x_synth_secret: str | None = Header(default=None)) -> dict[str, Any]:
    _check(x_synth_secret)
    if not req.blocks:
        raise HTTPException(status_code=400, detail="blocks[] required")
    return _run_script("sync_tasks.py", {"blocks": req.blocks, "env_name": req.env_name}, [])


@app.get("/jobs/{job_id}")
def job_status(job_id: str, x_synth_secret: str | None = Header(default=None)) -> dict[str, Any]:
    _check(x_synth_secret)
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    return {"status": job["status"], "result": job["result"]}
