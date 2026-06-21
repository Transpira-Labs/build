"""SC-bench golden tasks (tool-use track).

    hud eval golden/sc_bench/tasks.py <model> --gateway   # local
    hud sync tasks sc-bench golden/sc_bench/tasks.py       # to the platform
"""
import os
from env import env, tool_use  # noqa: F401  (re-export so eval resolves the Environment)

_N = int(os.environ.get("BENCH_N", "25"))
tasks = []
for _i in range(_N):
    _t = tool_use(idx=_i)
    _t.slug = f"tool-use-{_i:03d}"
    tasks.append(_t)
