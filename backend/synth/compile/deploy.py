"""
Deploy a compiled codebase to the HUD platform (pipeline step 5).

Step 4 produces a deployable project directory (`env.py` + `Dockerfile.hud` +
`pyproject.toml`); this shells out to `hud deploy <dir>`, which builds the image and
registers the environment by its `Environment(name=...)`. From there, baseline evals,
training, and the RL loop run on the platform against the registered env.

This is an **outward-facing publish** — it builds an image and registers it on HUD, and
needs a configured `HUD_API_KEY`. So it's only ever run when explicitly requested
(`synth-env --deploy`), and `dry_run=True` returns the exact command without executing it.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path


@dataclass
class DeployResult:
    ok: bool
    command: list[str]
    returncode: int | None = None
    env_name: str | None = None
    message: str = ""


def _hud_executable() -> str | None:
    """Prefer the `hud` next to the running interpreter (same venv), else PATH."""
    candidate = Path(sys.executable).parent / "hud"
    if candidate.exists():
        return str(candidate)
    return shutil.which("hud")


def has_api_key() -> bool:
    """True if a HUD_API_KEY is visible (process env, project .env, or ~/.hud/.env)."""
    try:
        from synth.tools.gateway import load_env

        load_env()
    except Exception:  # noqa: BLE001 - key discovery is best-effort
        pass
    return bool(os.environ.get("HUD_API_KEY"))


def build_deploy_command(
    directory: Path | str,
    *,
    hud: str = "hud",
    env: list[str] | None = None,
    env_file: str | None = None,
    no_cache: bool = False,
    verbose: bool = False,
    extra: list[str] | None = None,
) -> list[str]:
    """Construct the `hud deploy` argv for `directory`."""
    cmd = [hud, "deploy", str(directory)]
    for kv in env or []:
        cmd += ["--env", kv]
    if env_file:
        cmd += ["--env-file", str(env_file)]
    if no_cache:
        cmd.append("--no-cache")
    if verbose:
        cmd.append("--verbose")
    cmd += list(extra or [])
    return cmd


def deploy_codebase(
    directory: Path | str,
    *,
    env_name: str | None = None,
    env: list[str] | None = None,
    env_file: str | None = None,
    no_cache: bool = False,
    verbose: bool = False,
    extra: list[str] | None = None,
    dry_run: bool = False,
) -> DeployResult:
    """Deploy the project directory to HUD via `hud deploy` (build logs stream to the terminal)."""
    directory = Path(directory)

    # preflight — fail clearly rather than handing a broken context to `hud deploy`
    if not (directory / "env.py").exists():
        return DeployResult(ok=False, command=[], env_name=env_name, message=f"no env.py in {directory}")
    if not (directory / "Dockerfile.hud").exists():
        return DeployResult(ok=False, command=[], env_name=env_name,
                            message=f"no Dockerfile.hud in {directory} (run the compile step first)")
    hud = _hud_executable()
    if hud is None:
        return DeployResult(ok=False, command=[], env_name=env_name,
                            message="the `hud` CLI is not installed (pip install hud-python)")

    cmd = build_deploy_command(
        directory, hud=hud, env=env, env_file=env_file, no_cache=no_cache, verbose=verbose, extra=extra,
    )
    if dry_run:
        return DeployResult(ok=True, command=cmd, env_name=env_name, message="dry run — command not executed")

    proc = subprocess.run(cmd)  # inherit stdio so remote build logs stream live
    ok = proc.returncode == 0
    return DeployResult(
        ok=ok, command=cmd, returncode=proc.returncode, env_name=env_name,
        message="deployed" if ok else f"`hud deploy` exited with code {proc.returncode}",
    )
