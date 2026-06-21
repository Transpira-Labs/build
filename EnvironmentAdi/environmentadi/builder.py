"""Turn a spec into HUD environment source by prompting a builder model through
the HUD OpenAI-compatible gateway.

Only used by the real `hud` backend; the mock backend templates code directly.
The OpenAI client is imported lazily so the mock path needs no dependencies.
"""

from __future__ import annotations

import json
from pathlib import Path

from .spec import Spec

_SYSTEM_PROMPT = (Path(__file__).parent / "prompts" / "builder_system.md").read_text()


def _spec_as_json(spec: Spec) -> str:
    return json.dumps(
        {
            "project": {"id": spec.id, "name": spec.name, "version": spec.version},
            "environment": {
                "objective": spec.environment.objective,
                "inputs": spec.environment.inputs,
                "outputs": spec.environment.outputs,
            },
            "tools": [
                {"id": t.id, "name": t.name, "description": t.description}
                for t in spec.tools
            ],
            "tasks": [
                {
                    "id": t.id,
                    "name": t.name,
                    "prompt": t.prompt,
                    "reward": {"mode": t.reward.mode, "spec": t.reward.spec},
                }
                for t in spec.tasks
            ],
            "train": {
                "algorithm": spec.train.algorithm,
                "base_model": spec.train.base_model,
                "episodes": spec.train.episodes,
                "eval_split": spec.train.eval_split,
            },
        },
        indent=2,
    )


def build_env_code(
    spec: Spec, builder_model: str, *, base_url: str | None = None, api_key: str | None = None
) -> tuple[str, dict]:
    """Ask `builder_model` (via the HUD gateway) to write a HUD environment for
    `spec`. Returns (python_source, meta)."""
    try:
        from openai import OpenAI
    except ImportError as e:  # pragma: no cover - exercised only on the hud path
        raise RuntimeError(
            "openai is required for the hud backend: pip install 'environmentadi[hud]'"
        ) from e
    from .config import GATEWAY_URL, load_hud_key

    client = OpenAI(base_url=base_url or GATEWAY_URL, api_key=api_key or load_hud_key())
    # Note: no `temperature` — some gateway models (e.g. claude-opus-4-8) reject it.
    resp = client.chat.completions.create(
        model=builder_model,
        messages=[
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": f"Specification:\n{_spec_as_json(spec)}"},
        ],
    )
    code = _strip_fences(resp.choices[0].message.content or "")
    return code, {"builder_model": builder_model}


def _strip_fences(text: str) -> str:
    """Remove a ```python ... ``` wrapper if the model added one."""
    t = text.strip()
    if t.startswith("```"):
        lines = t.splitlines()
        lines = lines[1:]  # drop opening ```python
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        return "\n".join(lines).strip()
    return t
