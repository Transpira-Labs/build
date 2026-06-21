"""The real backend (eval-only cross-play).

Build: a builder model writes a HUD env via the gateway. Validate: the module
imports and exposes a non-empty `tasks` list. Train: a no-op in eval-only mode —
the "agent" for model i is simply model i used as the solver. Evaluate: run that
solver against another model's environment and average the rewards.

Verified recipe (see README): `Taskset.from_file(env.py)` + `create_agent(model)`
+ `taskset.run(agent, runtime=LocalRuntime(env.py))` → `Job.runs[*].reward`. For
text environments LocalRuntime runs the env as a local subprocess while inference
still routes remotely through the HUD gateway — no Docker, no deploy.
"""

from __future__ import annotations

import asyncio
import warnings
from pathlib import Path

from ..artifacts import Agent, EvalResult, GeneratedEnv, env_id
from ..builder import build_env_code
from ..config import load_hud_key
from ..spec import Spec

# Generated envs may use the v6-deprecated @env.tool()/add_tool path — cosmetic.
warnings.filterwarnings("ignore", message=r".*add_tool\(\) is deprecated.*")


def _slug(model: str) -> str:
    return model.replace("/", "_").replace(":", "_").replace(".", "-")


def _quiet_teardown(loop, context):  # noqa: ANN001
    """Swallow the benign stream/HTTP teardown noise HUD emits when each env
    subprocess is torn down after a rollout (CancelledError / 'Event loop is
    closed'); surface everything else normally."""
    exc = context.get("exception")
    msg = context.get("message", "")
    if isinstance(exc, asyncio.CancelledError):
        return
    if isinstance(exc, RuntimeError) and "Event loop is closed" in str(exc):
        return
    if "Event loop is closed" in msg:
        return
    loop.default_exception_handler(context)


class HudBackend:
    name = "hud"

    def __init__(
        self,
        out_dir: str = ".generated",
        *,
        group_size: int = 1,
        max_concurrent: int = 5,
        rollout_timeout: float | None = None,
        **_: object,
    ) -> None:
        load_hud_key()  # fail fast if the key is missing
        self.out_dir = Path(out_dir)
        self.group_size = group_size
        self.max_concurrent = max_concurrent
        self.rollout_timeout = rollout_timeout
        self._loop: asyncio.AbstractEventLoop | None = None

    def _get_loop(self) -> asyncio.AbstractEventLoop:
        # One loop for the whole tournament: avoids the per-call loop teardown
        # that otherwise spams "Event loop is closed" from lingering HTTP clients.
        if self._loop is None or self._loop.is_closed():
            self._loop = asyncio.new_event_loop()
            self._loop.set_exception_handler(_quiet_teardown)
        return self._loop

    def close(self) -> None:
        if self._loop and not self._loop.is_closed():
            self._loop.run_until_complete(asyncio.sleep(0.2))  # let aclose() drain
            self._loop.close()

    # -- build ------------------------------------------------------------

    def build(self, spec: Spec, builder_model: str) -> GeneratedEnv:
        try:
            code, meta = build_env_code(spec, builder_model)
        except Exception as e:  # noqa: BLE001 - a builder that errors just scores zero
            return GeneratedEnv(
                env_id=env_id(builder_model, spec.id),
                builder_model=builder_model,
                spec_id=spec.id,
                code="",
                valid=False,
                errors=(f"build failed: {type(e).__name__}: {e}",),
            )
        path = self.out_dir / f"{_slug(builder_model)}__{spec.id}" / "env.py"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(code)

        valid, errors, n_tasks = self._validate(path)
        meta["n_tasks"] = n_tasks
        return GeneratedEnv(
            env_id=env_id(builder_model, spec.id),
            builder_model=builder_model,
            spec_id=spec.id,
            code=code,
            path=str(path),
            valid=valid,
            errors=tuple(errors),
            meta=meta,
        )

    def _validate(self, path: Path) -> tuple[bool, list[str], int]:
        """The generated module must load a non-empty `tasks` list."""
        try:
            from hud.eval import Taskset

            ts = Taskset.from_file(str(path))
            n = len(ts)
            if n == 0:
                return False, ["loaded 0 tasks (missing module-level `tasks` list?)"], 0
            return True, [], n
        except Exception as e:  # noqa: BLE001 - any failure means an unusable env
            return False, [f"{type(e).__name__}: {e}"], 0

    # -- train (eval-only: no RL) ----------------------------------------

    def train(self, env: GeneratedEnv, spec: Spec) -> Agent:
        # The solver for model i's "agent" is model i itself (untrained).
        return Agent(
            agent_id=f"agent::{env.env_id}",
            builder_model=env.builder_model,
            env_id=env.env_id,
            spec_id=env.spec_id,
            train_meta={"mode": "eval-only", "solver_model": env.builder_model},
        )

    # -- evaluate (cross-play cell) --------------------------------------

    def evaluate(self, agent: Agent, env: GeneratedEnv, spec: Spec) -> EvalResult:
        if not env.valid or not env.path:
            return EvalResult(agent.agent_id, env.env_id, 0.0, {"reason": "env invalid"})
        solver = agent.train_meta.get("solver_model", agent.builder_model)
        try:
            score, n = self._get_loop().run_until_complete(self._run(env.path, solver))
            return EvalResult(agent.agent_id, env.env_id, round(score, 4),
                              {"solver": solver, "n_runs": n})
        except Exception as e:  # noqa: BLE001
            return EvalResult(agent.agent_id, env.env_id, 0.0,
                              {"solver": solver, "error": f"{type(e).__name__}: {e}"})

    async def _run(self, env_path: str, solver_model: str) -> tuple[float, int]:
        from hud.agents import create_agent
        from hud.eval import LocalRuntime, Taskset

        ts = Taskset.from_file(env_path)
        agent = create_agent(solver_model)
        job = await ts.run(
            agent,
            runtime=LocalRuntime(env_path),
            group=self.group_size,
            max_concurrent=self.max_concurrent,
            rollout_timeout=self.rollout_timeout,
        )
        rewards = [r.reward for r in job.runs if r.reward is not None]
        return (sum(rewards) / len(rewards) if rewards else 0.0), len(rewards)
