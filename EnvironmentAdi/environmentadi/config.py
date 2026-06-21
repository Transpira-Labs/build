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
BUILDERS: list[str] = [
    "openai/gpt-oss-120b",                 # GPT slot
    "Qwen/Qwen3-235B-A22B-Instruct-2507",  # Qwen slot
    "claude-sonnet-4-6",                   # Sonnet slot
]

GOLDEN_AUTHOR = "claude-opus-4-8"  # writes the golden benchmark env

# Probe / trainee run inside the grader. Qwen3-8B is the intended trainee and is
# is_trainable=true (so it's also the Phase-2 RL target).
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
