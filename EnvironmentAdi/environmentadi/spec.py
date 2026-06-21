"""The benchmark input: a JSON specification of the environment a builder model
must produce.

This mirrors the block builder's canonical IR (`build/src/lib/ir/schema.ts`):
`project / environment / tools[] / tasks[] / train`. It is intentionally a loose
dataclass rather than a strict pydantic model — the spec format is not frozen
yet, so we validate the load-bearing shape and keep the rest forgiving.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path


@dataclass(frozen=True)
class Tool:
    id: str
    name: str
    description: str = ""


@dataclass(frozen=True)
class Reward:
    # "guided" → a structured comparator; "advanced" → free-form rule text.
    mode: str = "guided"
    # Deterministic scoring rule, e.g. `answer == 3 -> 1.0 else 0.0`.
    spec: str = ""


@dataclass(frozen=True)
class Task:
    id: str
    name: str
    prompt: str
    reward: Reward = field(default_factory=Reward)


@dataclass(frozen=True)
class Environment:
    objective: str = ""
    inputs: str = ""
    outputs: str = ""


@dataclass(frozen=True)
class TrainCfg:
    algorithm: str = "grpo"
    base_model: str = "qwen3-8b"
    episodes: int = 100
    eval_split: float = 0.2


@dataclass(frozen=True)
class Spec:
    """One benchmark item: the JSON a builder model is asked to realize."""

    id: str
    name: str
    environment: Environment
    tools: tuple[Tool, ...] = ()
    tasks: tuple[Task, ...] = ()
    train: TrainCfg = field(default_factory=TrainCfg)
    version: int = 1

    # ---- loading --------------------------------------------------------

    @staticmethod
    def from_dict(data: dict) -> "Spec":
        proj = data.get("project", {})
        env = data.get("environment", {})
        tools = tuple(
            Tool(
                id=t.get("id", f"tool{i}"),
                name=t.get("name", "tool"),
                description=t.get("description", ""),
            )
            for i, t in enumerate(data.get("tools", []))
        )
        tasks = tuple(
            Task(
                id=t.get("id", f"task{i}"),
                name=t.get("name", "challenge"),
                prompt=t.get("prompt", ""),
                reward=Reward(
                    mode=t.get("reward", {}).get("mode", "guided"),
                    spec=t.get("reward", {}).get("spec", ""),
                ),
            )
            for i, t in enumerate(data.get("tasks", []))
        )
        tr = data.get("train", {})
        spec_id = proj.get("id") or data.get("id")
        if not spec_id:
            raise ValueError("spec is missing project.id / id")
        return Spec(
            id=spec_id,
            name=proj.get("name") or data.get("name") or spec_id,
            version=int(proj.get("version", 1)),
            environment=Environment(
                objective=env.get("objective", ""),
                inputs=env.get("inputs", ""),
                outputs=env.get("outputs", ""),
            ),
            tools=tools,
            tasks=tasks,
            train=TrainCfg(
                algorithm=tr.get("algorithm", "grpo"),
                base_model=tr.get("base_model", "qwen3-8b"),
                episodes=int(tr.get("episodes", 100)),
                eval_split=float(tr.get("eval_split", 0.2)),
            ),
        )

    @staticmethod
    def from_file(path: str | Path) -> "Spec":
        return Spec.from_dict(json.loads(Path(path).read_text()))


def load_specs(directory: str | Path) -> list[Spec]:
    """Load every `*.json` spec in a directory, sorted by filename for
    deterministic tournament ordering."""
    paths = sorted(Path(directory).glob("*.json"))
    if not paths:
        raise FileNotFoundError(f"no *.json specs found in {directory}")
    return [Spec.from_file(p) for p in paths]
