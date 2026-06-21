"""Orchestrate the cross-play tournament: build → validate → train → cross-eval
→ aggregate. Backend-agnostic; run with `--backend mock` to do it all offline.

Usage:
    python3 -m environmentadi.tournament --specs specs --backend mock \\
        --models gpt-mock,claude-mock,llama-mock
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .artifacts import Agent, GeneratedEnv, ScoreMatrix
from .backends import get_backend
from .backends.base import ExecutionBackend
from .scoring import format_matrix, format_rankings, rank
from .spec import Spec, load_specs


def run_tournament(
    specs: list[Spec],
    models: list[str],
    backend: ExecutionBackend,
    *,
    include_diagonal: bool = False,
    log=print,
) -> ScoreMatrix:
    """One spec per builder model (paired by index), then full cross-play.

    For a clean N×N matrix we pair model i with spec i: model i builds and trains
    on spec i's environment, then is evaluated on every other model's env.
    """
    if len(specs) < len(models):
        raise ValueError(
            f"need at least one spec per model: {len(models)} models, {len(specs)} specs"
        )

    # --- build + train: each model gets its own environment ---
    envs: dict[str, GeneratedEnv] = {}
    agents: dict[str, Agent] = {}
    for model, spec in zip(models, specs):
        log(f"[build]  {model:<14} on spec {spec.id}")
        env = backend.build(spec, model)
        envs[model] = env
        if not env.valid:
            log(f"         ! invalid env: {', '.join(env.errors)}")
            continue
        log(f"[train]  {model:<14} ({spec.train.episodes} episodes)")
        agents[model] = backend.train(env, spec)

    # spec lookup by the model that owns its env (for evaluate context)
    spec_of = dict(zip(models, specs))

    # --- cross-eval: agent_i on env_j ---
    matrix = ScoreMatrix(models=list(models), include_diagonal=include_diagonal)
    for a_model, agent in agents.items():
        for e_model, env in envs.items():
            if a_model == e_model and not include_diagonal:
                continue
            res = backend.evaluate(agent, env, spec_of[e_model])
            matrix.set(a_model, e_model, res.score)
    return matrix


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Cross-play HUD environment-building benchmark")
    p.add_argument("--specs", default="specs", help="directory of *.json specs")
    p.add_argument("--backend", default="mock", choices=["mock", "hud"])
    p.add_argument(
        "--models",
        default=None,
        help="comma-separated builder model ids (default: mock ids for mock "
        "backend, config.BUILDERS for hud)",
    )
    p.add_argument("--include-diagonal", action="store_true",
                   help="also score each agent on its own environment")
    p.add_argument("--out", default=None, help="write the score matrix JSON here")
    args = p.parse_args(argv)

    if args.models:
        models = [m.strip() for m in args.models.split(",") if m.strip()]
    elif args.backend == "hud":
        from .config import BUILDERS
        models = list(BUILDERS)
    else:
        models = ["gpt-mock", "claude-mock", "llama-mock"]
    specs = load_specs(args.specs)
    backend = get_backend(args.backend)

    print(f"backend={backend.name}  models={len(models)}  specs={len(specs)}\n")
    try:
        matrix = run_tournament(specs[: len(models)], models, backend,
                                include_diagonal=args.include_diagonal)
    finally:
        if hasattr(backend, "close"):
            backend.close()

    print("\nCross-play matrix (row = agent, col = environment):")
    print(format_matrix(matrix))
    print("\nLeaderboard:")
    print(format_rankings(rank(matrix)))

    if args.out:
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        matrix.save(args.out)
        print(f"\nsaved matrix → {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
