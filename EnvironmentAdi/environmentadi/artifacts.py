"""Artifacts that flow through the tournament: a generated environment, an agent
trained inside it, a single cross-eval result, and the final score matrix."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path


@dataclass
class GeneratedEnv:
    """A HUD environment a builder model produced from a spec."""

    env_id: str            # f"{builder_model}::{spec_id}"
    builder_model: str
    spec_id: str
    code: str              # the generated HUD environment source (env.py)
    path: str | None = None  # where code was written (LocalRuntime / Taskset source)
    valid: bool = True     # did it import + load tasks?
    errors: tuple[str, ...] = ()
    meta: dict = field(default_factory=dict)


@dataclass
class Agent:
    """An agent trained inside one GeneratedEnv."""

    agent_id: str          # f"agent::{env_id}"
    builder_model: str
    env_id: str
    spec_id: str
    train_meta: dict = field(default_factory=dict)


@dataclass
class EvalResult:
    """Score of one agent run against one environment (one matrix cell)."""

    agent_id: str
    env_id: str            # the environment it was evaluated on
    score: float           # mean reward in [0, 1]
    detail: dict = field(default_factory=dict)


@dataclass
class ScoreMatrix:
    """Cross-play results. Rows = agents (by builder model), cols = envs."""

    models: list[str]                  # ordering for rows and columns
    # cells[(agent_model, env_model)] = score
    cells: dict[tuple[str, str], float] = field(default_factory=dict)
    include_diagonal: bool = False     # is an agent scored on its own env?

    def set(self, agent_model: str, env_model: str, score: float) -> None:
        self.cells[(agent_model, env_model)] = score

    def get(self, agent_model: str, env_model: str) -> float | None:
        return self.cells.get((agent_model, env_model))

    def to_dict(self) -> dict:
        return {
            "models": self.models,
            "include_diagonal": self.include_diagonal,
            "cells": [
                {"agent": a, "env": e, "score": s}
                for (a, e), s in self.cells.items()
            ],
        }

    def save(self, path: str | Path) -> None:
        Path(path).write_text(json.dumps(self.to_dict(), indent=2))


def env_id(builder_model: str, spec_id: str) -> str:
    return f"{builder_model}::{spec_id}"


def dump(obj) -> dict:
    """JSON-friendly view of any artifact dataclass."""
    return asdict(obj)
