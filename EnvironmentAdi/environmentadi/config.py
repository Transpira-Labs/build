"""Single place for the builder roster and gateway settings.

The roster IDs are HUD gateway model ids (see `hud models`). Change them here;
nothing else in the harness hard-codes a model.
"""

from __future__ import annotations

import os
import re
from pathlib import Path

# --- bench-ception roles -------------------------------------------------
# Builders compete to create the best environment for one spec. A probe/trainee
# is then evaluated on each built env. The golden author writes the held-out
# benchmark env the trainees will (eventually) be judged against.
#
# These are the originally-INTENDED open models — they work on the v6 beta gateway
# with their fully-qualified ids (the bare names / the old non-beta endpoint do
# NOT work, which is what caused the earlier "Tinker SDK" confusion).
# bench-ception v3: two builders each build a FULL supply-chain env + training set
# from the same SC-bench prompt; a trainee is RL-trained on each; trained models
# are judged on the GOLDEN held-out SC-bench. Only these two are builders.
BUILDERS: list[str] = [
    "claude-opus-4-8",
    "gpt-5.5",
]

# The trainee: forked per builder env and RL-trained, then evaluated on the golden.
TRAINEE = os.environ.get("BENCHCEPTION_TRAINEE", "Qwen/Qwen3-8B")

# The GOLDEN held-out benchmark — the real SC-bench (ACL 2026), ported to HUD.
GOLDEN_ENV = str(Path(__file__).parent.parent / "golden" / "sc_bench" / "tasks.py")
GOLDEN_TASKSET = "sc-bench"  # name on the HUD platform (hud sync tasks)

# Kept for the older cross-play/probe flow (capture.py / run_benchception.py).
GOLDEN_AUTHOR = "claude-opus-4-8"
PROBE_MODEL = os.environ.get("BENCHCEPTION_PROBE", "Qwen/Qwen3-8B")


def _default_gateway() -> str:
    """The v6 gateway (https://inference.beta.hud.ai). Source it from the SDK so
    it always matches the installed version; fall back to the beta URL."""
    if os.environ.get("HUD_GATEWAY_URL"):
        return os.environ["HUD_GATEWAY_URL"]
    try:
        from hud.settings import settings

        return settings.hud_gateway_url
    except Exception:
        return "https://inference.beta.hud.ai"


# HUD OpenAI-compatible inference gateway (no trailing /v1; the SDK appends paths).
GATEWAY_URL = _default_gateway()


def load_hud_key() -> str:
    """Return the HUD API key from the environment or hud's stored config."""
    key = os.environ.get("HUD_API_KEY")
    if key:
        return key
    cfg = Path.home() / ".hud" / ".env"
    if cfg.exists():
        for line in cfg.read_text().splitlines():
            m = re.match(r'\s*(?:export\s+)?HUD_API_KEY\s*=\s*"?([^"\n]+)"?', line)
            if m:
                return m.group(1)
    raise RuntimeError(
        "HUD_API_KEY not found. Run `hud set HUD_API_KEY=...` or export it."
    )
