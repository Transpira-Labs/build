"""Execution backends. The expensive HUD layer (LLM build, RL training, eval)
lives behind a single interface so the harness can run fully offline."""

from .base import ExecutionBackend
from .mock import MockBackend


def get_backend(name: str, **kwargs) -> ExecutionBackend:
    if name == "mock":
        return MockBackend(**kwargs)
    if name == "hud":
        from .hud import HudBackend

        return HudBackend(**kwargs)
    raise ValueError(f"unknown backend {name!r} (expected 'mock' or 'hud')")


__all__ = ["ExecutionBackend", "MockBackend", "get_backend"]
