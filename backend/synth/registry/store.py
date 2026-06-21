"""
Run registry (pipeline step 8) — persist baseline + training runs, keyed by env+version.

Everything is keyed by `(env_name, version)`, where `version` is the `0.1.0+<hash>` pinned
at compile. That keying is what keeps comparisons honest: recompiling an env yields a new
hash → a new bucket, so a trained run is never compared against a baseline from a different
env. Payloads are the `to_dict()` outputs from steps 6/7; we store **trace/job links, not
full trajectories**.

JSON-backed and dependency-free. The `Registry` is the read/write API the CLI and the
read-only HTTP endpoint both sit on.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _as_dict(obj: Any) -> dict:
    return obj.to_dict() if hasattr(obj, "to_dict") else dict(obj)


class Registry:
    def __init__(self, data: dict | None = None, *, path: str | Path | None = None):
        self.data: dict[str, Any] = data or {"environments": {}}
        self.data.setdefault("environments", {})
        self.path = Path(path) if path else None

    # ── persistence ──────────────────────────────────────────────────────────
    @classmethod
    def load(cls, path: str | Path) -> "Registry":
        p = Path(path)
        if p.exists():
            return cls(json.loads(p.read_text()), path=p)
        return cls(path=p)

    def save(self, path: str | Path | None = None) -> Path:
        target = Path(path) if path else self.path
        if target is None:
            raise ValueError("Registry has no path to save to")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(self.data, indent=2))
        return target

    # ── writes ───────────────────────────────────────────────────────────────
    def _bucket(self, env: str, version: str) -> dict:
        envs = self.data.setdefault("environments", {})
        return envs.setdefault(env, {}).setdefault(version, {"baseline": None, "training": []})

    def record_baseline(self, env: str, version: str, leaderboard: Any, *,
                        job_id: str | None = None, traces: list[str] | None = None,
                        at: str | None = None) -> dict:
        lb = _as_dict(leaderboard)
        record = {
            "at": at or _now(),
            "job_id": job_id,
            "ceiling": lb.get("ceiling"),
            "solvable": lb.get("solvable"),
            "discriminating": lb.get("discriminating"),
            "leaderboard": lb,
            "traces": list(traces or []),
        }
        self._bucket(env, version)["baseline"] = record
        return record

    def record_training(self, env: str, version: str, result: Any, *,
                        base: str | None = None, traces: list[str] | None = None,
                        at: str | None = None) -> dict:
        res = _as_dict(result)
        record = {
            "at": at or _now(),
            "model_slug": res.get("model_slug"),
            "base": base,
            "head_id": res.get("head_id"),
            "best": (res.get("curve") or {}).get("best"),
            "curve": res.get("curve"),
            "traces": list(traces or []),
        }
        self._bucket(env, version)["training"].append(record)
        return record

    # ── reads ────────────────────────────────────────────────────────────────
    def environments(self) -> list[str]:
        return sorted(self.data.get("environments", {}))

    def versions(self, env: str) -> list[str]:
        return sorted(self.data.get("environments", {}).get(env, {}))

    def get(self, env: str, version: str) -> dict | None:
        return self.data.get("environments", {}).get(env, {}).get(version)

    def compare(self, env: str, version: str) -> dict:
        """Baseline-vs-best-training for one env+version. Delta is honest by construction."""
        bucket = self.get(env, version)
        if not bucket:
            return {"env": env, "version": version, "found": False}

        baseline = bucket.get("baseline")
        trainings = bucket.get("training") or []
        baseline_ceiling = baseline.get("ceiling") if baseline else None
        best = max(trainings, key=lambda t: (t.get("best") or 0.0), default=None)
        trained_best = best.get("best") if best else None
        delta = (trained_best - baseline_ceiling) if (
            trained_best is not None and baseline_ceiling is not None) else None

        return {
            "env": env, "version": version, "found": True,
            "baseline_ceiling": baseline_ceiling,
            "trained_best": trained_best,
            "delta": delta,
            "model_slug": best.get("model_slug") if best else None,
            "head_id": best.get("head_id") if best else None,
            # honest: both sides exist for the SAME version (the keying guarantees it)
            "honest": baseline_ceiling is not None and trained_best is not None,
        }
