"""
Bridge for the web app: read a HUD job's per-trace status + reward, live. Reads
`{"job_id": "..."}` from **stdin** and prints ONE JSON object to **stdout**.

Uses the HUD SDK's `PlatformClient` (GET /jobs/<id>/traces) so it talks to the
same beta backend the env deployed to — HUD_API_URL is dropped upstream so the
SDK resolves its beta default. Each trace carries a `status` (running / pending /
completed / failed) and a `reward` once graded; the web app polls this to show
whether rollouts are still in flight and to surface scores as they land.
"""

from __future__ import annotations

import json
import sys
from typing import Any


def main() -> int:
    try:
        req = json.loads(sys.stdin.read())
    except json.JSONDecodeError as e:
        print(json.dumps({"ok": False, "error": f"invalid JSON on stdin: {e}"}))
        return 1

    job_id = (req.get("job_id") or "").strip()
    if not job_id:
        print(json.dumps({"ok": False, "error": "job_id required"}))
        return 1

    try:
        from hud.utils.platform import PlatformClient

        client = PlatformClient.from_settings()
        data = client.get(f"/jobs/{job_id}/traces", params={"limit": 500})
    except Exception as e:  # noqa: BLE001 - surface as JSON, never crash
        print(json.dumps({"ok": False, "error": str(e), "job_id": job_id}))
        return 1

    items = data if isinstance(data, list) else (data.get("items") or [])
    traces: list[dict[str, Any]] = []
    for tr in items:
        if not isinstance(tr, dict):
            continue
        reward = tr.get("reward")
        traces.append(
            {
                "id": str(tr.get("id") or ""),
                "status": (tr.get("status") or "").lower(),
                "reward": reward if isinstance(reward, (int, float)) else None,
                "error": (tr.get("error") or None),
            }
        )

    rewards = [t["reward"] for t in traces if isinstance(t["reward"], (int, float))]
    print(
        json.dumps(
            {
                "ok": True,
                "job_id": job_id,
                "job_url": f"https://hud.ai/jobs/{job_id}",
                "traces": traces,
                "mean_reward": (sum(rewards) / len(rewards)) if rewards else None,
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
