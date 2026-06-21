"""
Read-only HTTP endpoint for the registry (the dashboard the UI reads).

Dependency-free (stdlib `http.server`). `route()` is pure — it maps a GET path to a
`(status, body)` pair, so it's unit-testable without binding a socket — and `serve()` is the
thin server wrapper around it. Read-only: it never mutates the registry.

    GET /environments                       → ["research_agent", ...]
    GET /env/<name>                         → { versions: [...] }
    GET /env/<name>/<version>               → the full bucket
    GET /env/<name>/<version>/compare       → baseline-vs-trained delta
"""

from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any
from urllib.parse import unquote

from synth.registry.store import Registry


def route(registry: Registry, path: str) -> tuple[int, dict[str, Any]]:
    """Map a GET path to (status, json-body). Pure — no I/O."""
    parts = [unquote(p) for p in path.split("?")[0].strip("/").split("/") if p]

    if not parts or parts == ["environments"]:
        return 200, {"environments": registry.environments()}

    if parts[0] == "env" and len(parts) >= 2:
        env = parts[1]
        if len(parts) == 2:
            return 200, {"env": env, "versions": registry.versions(env)}
        version = parts[2]
        if len(parts) == 3:
            bucket = registry.get(env, version)
            return (200, bucket) if bucket else (404, {"error": "not found", "env": env, "version": version})
        if len(parts) == 4 and parts[3] == "compare":
            return 200, registry.compare(env, version)

    return 404, {"error": "not found", "path": path}


def make_handler(registry: Registry):
    class _Handler(BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802 - http.server API
            status, body = route(registry, self.path)
            payload = json.dumps(body, indent=2).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")  # the UI reads this cross-origin
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, *args):  # silence per-request logging
            return

    return _Handler


def serve(registry: Registry, *, host: str = "127.0.0.1", port: int = 8088) -> None:
    httpd = HTTPServer((host, port), make_handler(registry))
    print(f"[registry] serving on http://{host}:{port}  "
          "(GET /environments, /env/<name>, /env/<name>/<version>[/compare])")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        httpd.shutdown()
