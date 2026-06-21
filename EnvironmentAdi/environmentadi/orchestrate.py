"""Orchestrator: the entrypoint the Scratch UI calls to kick off a bench-ception
run over the environments a user has built.

Clean filesystem contract (so nothing in the app or in EnvironmentAdi has to know
about the other's internals):

  * the app writes each environment's IR JSON into the inbox dir (one file each);
  * this orchestrator reads the inbox, and — once there are at least `threshold`
    specs — runs bench-ception (capture.py) over them, writing the dashboard data
    and a status file the app polls.

    python -m environmentadi.orchestrate --inbox inbox --threshold 3 \\
        --status-file dashboard/run_status.json
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

from . import capture

ROOT = Path(__file__).parent.parent
DASH = ROOT / "dashboard"


def _write_status(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2))


def _summarize() -> dict:
    """Compact leaderboard pulled from the freshly written dashboard/data.js."""
    djs = DASH / "data.js"
    if not djs.exists():
        return {}
    raw = re.sub(r"^window\.BENCHCEPTION_DATA = ", "", djs.read_text()).rstrip().rstrip(";")
    d = json.loads(raw)
    specs = [{"name": s["name"], "file": s["file"],
              "builders": [{"model": b["model"], "role": b["role"],
                            "best": b.get("score_best"), "mean": b.get("score_mean"),
                            "valid": f"{b.get('valid_count')}/{b.get('n_attempts')}"}
                           for b in s["builders"]]}
             for s in d.get("specs", [])]
    return {"meta": d.get("meta", {}), "specs": specs}


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="kick off a bench-ception run over inbox specs")
    p.add_argument("--inbox", default=str(ROOT / "inbox"))
    p.add_argument("--threshold", type=int, default=1)
    p.add_argument("--status-file", default=str(DASH / "run_status.json"))
    p.add_argument("--generated-at", default="")
    p.add_argument("--build-attempts", type=int, default=3)
    p.add_argument("--group", type=int, default=1)
    p.add_argument("--probe", default=None)
    args = p.parse_args(argv)

    inbox = Path(args.inbox)
    status = Path(args.status_file)
    specs = sorted(str(x) for x in inbox.glob("*.json"))

    if len(specs) < args.threshold:
        _write_status(status, {"state": "waiting", "count": len(specs),
                               "threshold": args.threshold,
                               "message": f"{len(specs)}/{args.threshold} environments — "
                                          "build more before running bench-ception."})
        print(f"waiting: {len(specs)}/{args.threshold} specs in {inbox}")
        return 0

    _write_status(status, {"state": "running", "count": len(specs),
                           "threshold": args.threshold,
                           "specs": [Path(s).name for s in specs]})
    print(f"running bench-ception over {len(specs)} spec(s) from {inbox}")

    cap_argv = ["--specs", *specs, "--build-attempts", str(args.build_attempts),
                "--group", str(args.group)]
    if args.generated_at:
        cap_argv += ["--generated-at", args.generated_at]
    if args.probe:
        cap_argv += ["--probe", args.probe]

    try:
        capture.main(cap_argv)
    except Exception as e:  # noqa: BLE001
        _write_status(status, {"state": "error", "count": len(specs),
                               "error": f"{type(e).__name__}: {e}"})
        raise

    _write_status(status, {"state": "done", "count": len(specs),
                           "dashboard": "dashboard/index.html",
                           "results": _summarize()})
    print("done — wrote dashboard/data.js and status")
    return 0


if __name__ == "__main__":
    sys.exit(main())
