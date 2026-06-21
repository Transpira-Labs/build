"""
Crash-guard + logging shared by the web-app bridge scripts (deploy_one, eval_one,
train_one, run_taskset, job_traces).

Problem it solves: when a bridge raised *before* printing its result JSON — an import
error, an early exception, or a host OOM-kill — the Next route only saw an empty stdout
and reported the opaque "backend returned no JSON", with no way to tell what broke.

`run(script, main)` wraps a bridge's `main()` so it ALWAYS emits exactly one JSON line
(an `{ok, error, traceback}` object on any uncaught failure) and records the failure to
stderr (captured by the host's log viewer, e.g. Railway) and to a per-script log file for
later review.
"""

from __future__ import annotations

import datetime
import json
import os
import sys
import traceback
from pathlib import Path

LOG_DIR = Path(os.environ.get("SYNTH_LOG_DIR", "/tmp/synth-logs"))


def log(script: str, message: str) -> None:
    """Append a timestamped entry to <LOG_DIR>/<script>.log. Never raises."""
    try:
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        stamp = datetime.datetime.now(datetime.timezone.utc).isoformat()
        with (LOG_DIR / f"{script}.log").open("a") as fh:
            fh.write(f"\n===== {stamp} =====\n{message}\n")
    except Exception:  # noqa: BLE001 - logging must never crash the guard
        pass


def run(script: str, main) -> None:
    """Run `main()`, guaranteeing one JSON line on stdout even if it crashes early.

    On any uncaught exception: print `{ok:false, error, traceback}` to stdout (so the
    web app gets a parseable, reviewable error instead of "backend returned no JSON"),
    mirror it to stderr, and append it to the per-script log file. Exits with main()'s
    return code, or 1 on crash.
    """
    try:
        code = main()
    except SystemExit:
        raise
    except BaseException as exc:  # noqa: BLE001 - the whole point is to catch everything
        tb = traceback.format_exc()
        sys.stderr.write(f"[bridge-error] {script}: {exc}\n{tb}\n")
        log(script, tb)
        # stdout was restored by now (any redirect_stdout context has exited on the
        # exception), so this JSON lands on real stdout for the Next route to parse.
        print(json.dumps({"ok": False, "error": f"{script} crashed: {exc}", "traceback": tb}))
        raise SystemExit(1)
    raise SystemExit(code)
