"""
CLI: persist and serve the run registry (pipeline step 8).

    # ingest the -o JSON written by steps 6/7, keyed by env + the pinned version
    synth-registry add-baseline --env research_agent --version 0.1.0+0fbeba1d --from lb.json
    synth-registry add-training --env research_agent --version 0.1.0+0fbeba1d --from train.json --base Qwen/Qwen3.5-4B

    synth-registry show     [--env research_agent [--version 0.1.0+0fbeba1d]]
    synth-registry compare  --env research_agent --version 0.1.0+0fbeba1d
    synth-registry serve    --port 8088          # the read-only endpoint the UI reads

All commands take --registry (default: registry.json).
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from synth.registry.server import serve
from synth.registry.store import Registry


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="synth-registry", description="Persist and serve env run records.")
    ap.add_argument("--registry", default="registry.json", help="registry JSON path (default: registry.json)")
    sub = ap.add_subparsers(dest="cmd", required=True)

    for name in ("add-baseline", "add-training"):
        p = sub.add_parser(name)
        p.add_argument("--env", required=True)
        p.add_argument("--version", required=True)
        p.add_argument("--from", dest="src", required=True, help="the -o JSON from step 6/7")
        p.add_argument("--trace", action="append", default=[], help="HUD trace/job link (repeatable)")
        if name == "add-training":
            p.add_argument("--base", default=None, help="the base model the slug was forked from")

    p_show = sub.add_parser("show")
    p_show.add_argument("--env", default=None)
    p_show.add_argument("--version", default=None)

    p_cmp = sub.add_parser("compare")
    p_cmp.add_argument("--env", required=True)
    p_cmp.add_argument("--version", required=True)

    p_serve = sub.add_parser("serve")
    p_serve.add_argument("--host", default="127.0.0.1")
    p_serve.add_argument("--port", type=int, default=8088)

    args = ap.parse_args(argv)
    reg = Registry.load(args.registry)

    if args.cmd == "add-baseline":
        payload = json.loads(Path(args.src).read_text())
        reg.record_baseline(args.env, args.version, payload, traces=args.trace)
        reg.save()
        print(f"[registry] recorded baseline for {args.env} {args.version} → {args.registry}")
        print(json.dumps(reg.compare(args.env, args.version), indent=2))
        return 0

    if args.cmd == "add-training":
        payload = json.loads(Path(args.src).read_text())
        reg.record_training(args.env, args.version, payload, base=args.base, traces=args.trace)
        reg.save()
        print(f"[registry] recorded training for {args.env} {args.version} → {args.registry}")
        print(json.dumps(reg.compare(args.env, args.version), indent=2))
        return 0

    if args.cmd == "show":
        if args.env and args.version:
            print(json.dumps(reg.get(args.env, args.version) or {"found": False}, indent=2))
        elif args.env:
            print(json.dumps({"env": args.env, "versions": reg.versions(args.env)}, indent=2))
        else:
            print(json.dumps({"environments": reg.environments()}, indent=2))
        return 0

    if args.cmd == "compare":
        print(json.dumps(reg.compare(args.env, args.version), indent=2))
        return 0

    if args.cmd == "serve":
        serve(reg, host=args.host, port=args.port)
        return 0

    return 1


if __name__ == "__main__":
    raise SystemExit(main())
