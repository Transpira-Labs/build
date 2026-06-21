"""The contract every execution backend implements. The tournament knows only
this interface, never whether work is mocked or run on real HUD."""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from ..artifacts import Agent, EvalResult, GeneratedEnv
from ..spec import Spec


@runtime_checkable
class ExecutionBackend(Protocol):
    name: str

    def build(self, spec: Spec, builder_model: str) -> GeneratedEnv:
        """Have `builder_model` produce a HUD environment from `spec`."""
        ...

    def train(self, env: GeneratedEnv, spec: Spec) -> Agent:
        """Train an agent inside a (valid) generated environment."""
        ...

    def evaluate(self, agent: Agent, env: GeneratedEnv, spec: Spec) -> EvalResult:
        """Run `agent` against `env`; return mean reward in [0, 1].

        This is the cross-play cell: `agent` was trained on a *different*
        environment than `env`.
        """
        ...
