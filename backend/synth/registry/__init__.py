"""Pipeline step 8 (registry + dashboard): persist baseline/training runs and serve them.

`Registry` is the JSON-backed store keyed by (env_name, version); `route`/`serve` are the
read-only HTTP endpoint the UI reads. Runs are ingested from the `to_dict()` JSON that steps
6/7 already produce.
"""

from synth.registry.server import route, serve
from synth.registry.store import Registry

__all__ = ["Registry", "route", "serve"]
