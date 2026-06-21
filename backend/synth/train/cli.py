"""
CLI: train a model on a task source through HUD's managed trainer (pipeline step 7).

    synth-train out/env.py --model arith-rl --steps 10 --group 8
    synth-train "research_agent" --model arith-rl --baseline lb.json     # on HUD, gated by baseline
    synth-train out/env.py --base Qwen/Qwen3.5-4B --fork --model arith-rl # fork a trainable slug first
    synth-train out/env.py --model arith-rl --expert-iteration --threshold 0.5
    synth-train out/env.py --model arith-rl --dry-run

Needs a HUD_API_KEY and a *trainable* model; real runs cost compute, so they're explicit.
Pass the step-6 leaderboard JSON via --baseline to gate on reward spread and to read the
curve against the baseline ceiling. Writes the training result JSON with -o.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from synth.train.loop import TrainConfig, TrainPlan, fork_model, run_training


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="synth-train", description="Train a model on a task source via HUD.")
    ap.add_argument("source", help="task source: a .py file (local) or a deployed taskset name (HUD)")
    ap.add_argument("--model", required=True, help="trainable model slug (what you sample AND train)")
    ap.add_argument("--base", default=None, help="base model to fork from (with --fork)")
    ap.add_argument("--fork", action="store_true", help="fork --base into --model before training")
    ap.add_argument("--steps", type=int, default=10)
    ap.add_argument("--group", type=int, default=8, help="rollouts per task (the GRPO group)")
    ap.add_argument("--lr", type=float, default=1e-5, dest="learning_rate")
    ap.add_argument("--loss", default=None, help="loss_fn (default: importance_sampling; e.g. ppo)")
    ap.add_argument("--expert-iteration", action="store_true",
                    help="rejection-sampling fine-tune (cross_entropy on high-reward runs)")
    ap.add_argument("--threshold", type=float, default=0.5, help="expert-iteration keep-threshold")
    ap.add_argument("--baseline", default=None, help="step-6 leaderboard JSON (trainability gate + ceiling)")
    ap.add_argument("--dry-run", action="store_true", help="print the plan without running")
    ap.add_argument("-o", "--out", default=None, help="write the training result JSON here")
    args = ap.parse_args(argv)

    config = TrainConfig(
        model_slug=args.model, steps=args.steps, group=args.group,
        learning_rate=args.learning_rate,
        loss_fn=args.loss, mode="expert_iteration" if args.expert_iteration else "grpo",
        reward_threshold=args.threshold,
    )
    baseline = json.loads(Path(args.baseline).read_text()) if args.baseline else None

    if not args.dry_run:
        from synth.compile.deploy import has_api_key

        if not has_api_key():
            print("[train] no HUD_API_KEY found — run `hud set HUD_API_KEY=...` (or pass --dry-run).")
            return 1

    if args.fork:
        if not args.base:
            print("[train] --fork requires --base <model>.")
            return 1
        fork = fork_model(args.base, args.model, dry_run=args.dry_run)
        print("[train] $ " + " ".join(fork.command))
        print(f"[train] fork: {fork.message}")
        if not fork.ok:
            return 1

    result = run_training(config, args.source, baseline=baseline, dry_run=args.dry_run)

    if isinstance(result, TrainPlan):
        print(f"[train] DRY RUN — would train {result.config.model_slug} on {result.source}: "
              f"{result.config.steps} steps × group {result.config.group}, mode={result.config.mode}, "
              f"loss={result.config.loss_fn or 'default'}")
        return 0

    c = result.curve
    print(f"[train] {result.model_slug}: reward {c.start:.3f} → {c.end:.3f} "
          f"(best {c.best:.3f}) over {len(c.points)} checkpoint(s); head={result.head_id}")
    for d in result.diagnostics:
        print(f"  [{d.level}] {d.code}: {d.message}")
    if args.out:
        Path(args.out).write_text(json.dumps(result.to_dict(), indent=2))
        print(f"[train] wrote {args.out}")
    return 0 if result.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
