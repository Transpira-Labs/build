"""
LLM access through the HUD inference gateway.

The gateway (`inference.hud.ai`) is an OpenAI-compatible endpoint fronting every
provider behind a single `HUD_API_KEY`, with unified tracing — so all of synthesis,
rollouts, and training share one key. We talk to it with the OpenAI SDK.

`complete_json` is the one entry point used by both extraction and codegen: it forces
a single function/tool call against a JSON schema and returns the parsed arguments,
or None when no key is configured or the call fails (callers then degrade gracefully).
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any

DEFAULT_GATEWAY_URL = "https://inference.hud.ai/v1"
DEFAULT_MODEL = "claude-sonnet-4-6"  # any gateway-known id works; override via SYNTH_MODEL

_loaded = False


def load_env() -> None:
    """Populate os.environ from ~/.hud/.env and ./.env without overriding real env.

    Precedence ends up: process env > project .env > ~/.hud/.env — matching `hud`.
    """
    global _loaded
    if _loaded:
        return
    for path in (Path.cwd() / ".env", Path.home() / ".hud" / ".env"):
        if not path.is_file():
            continue
        for line in path.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            key, val = key.strip(), val.strip().strip('"').strip("'")
            os.environ.setdefault(key, val)  # setdefault → never override
    _loaded = True


def llm_available() -> bool:
    """True iff a HUD_API_KEY is configured (after loading .env files)."""
    load_env()
    return bool(os.environ.get("HUD_API_KEY"))


def preflight_llm(*, use_llm: bool, context: str) -> bool:
    """Preflight the LLM before a run; return whether the LLM is actually usable.

    The failure we are guarding against is silent: with no HUD_API_KEY every gateway
    call returns None and the synthesizers quietly degrade to templates/stubs, so a
    run "succeeds" while producing an empty, LLM-free environment. When LLM mode is on
    but no key is configured we make that loud here — once, on stderr — and report the
    real (offline) capability back to the caller so the rest of the run is deterministic
    and self-consistent rather than half-working.
    """
    if not use_llm:
        return False
    if llm_available():
        return True
    print(
        "\n".join([
            "",
            "=" * 72,
            f"  ERROR: HUD_API_KEY is not set — {context} cannot use the LLM.",
            "",
            "  All LLM synthesis (JSON extraction, tool codegen, task planning) is",
            "  DISABLED. This run will fall back to templates + stubs and will NOT",
            "  produce real, LLM-generated tool bodies or tasks.",
            "",
            "  Fix: set HUD_API_KEY in your environment, or in a .env file in the",
            "  directory you launch the backend from (or ~/.hud/.env). To run offline",
            "  on purpose and silence this message, pass --no-llm.",
            "=" * 72,
            "",
        ]),
        file=sys.stderr,
    )
    return False


def get_client() -> tuple[Any, str] | None:
    """Return (OpenAI client bound to the HUD gateway, model) or None if no key."""
    load_env()
    key = os.environ.get("HUD_API_KEY")
    if not key:
        return None
    try:
        from openai import OpenAI
    except ImportError:
        return None
    base = os.environ.get("HUD_GATEWAY_URL", DEFAULT_GATEWAY_URL)
    model = os.environ.get("SYNTH_MODEL", DEFAULT_MODEL)
    return OpenAI(api_key=key, base_url=base), model


def complete_json(
    *, system: str, user: str, schema: dict, fn_name: str, fn_description: str = ""
) -> dict | None:
    """Force one tool call against `schema` and return its parsed arguments."""
    made = get_client()
    if made is None:
        return None
    client, model = made
    try:
        resp = client.chat.completions.create(
            model=model,
            max_tokens=4096,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            tools=[{
                "type": "function",
                "function": {
                    "name": fn_name,
                    "description": fn_description or fn_name,
                    "parameters": schema,
                },
            }],
            tool_choice={"type": "function", "function": {"name": fn_name}},
        )
        msg = resp.choices[0].message
        if msg.tool_calls:
            return json.loads(msg.tool_calls[0].function.arguments)
        if msg.content:  # some models answer with raw JSON instead of a tool call
            return _parse_json_blob(msg.content)
        return None
    except Exception as exc:  # noqa: BLE001 - any failure degrades to the caller's fallback
        print(f"[tool-synth] gateway call failed ({exc!r}); falling back.")
        return None


def _parse_json_blob(text: str) -> dict | None:
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        return None
    try:
        return json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return None
