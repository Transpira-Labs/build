"""
The step-4 build IR: a slotted intermediate representation + a reducer/renderer.

The input JSON is open-ended, but a deployable HUD project has a *finite* set of
extension points. So step 4 is total over the **output slots**, not the **input types**:
each synthesizer emits `EnvContribution`s that target named slots, `reduce_contributions`
merges them into a `BuildIR`, and `render_env_py` turns the IR into source. Adding a new
block type means adding a contributor — never editing this file.

Slots (env.py):  imports · pre_env (defs before `env`) · post_env (code that uses `env`)
                 capabilities (constructor) · taskset_calls
Slots (project): py_deps · system_deps · files · env_vars   (rendered to pyproject/Dockerfile
                 in a later step; collected here so they're ready).

Nothing is dropped silently: unmergeable things (name collisions, conflicting files) become
error diagnostics, and the assembler degrades rather than crashing.
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
from dataclasses import dataclass, field

from synth.tasks.spec import Diagnostic


@dataclass
class EnvContribution:
    """One synthesizer's contribution to the build, expressed in slots (never raw env.py)."""

    source: str  # who produced it — for diagnostics/provenance
    imports: list[str] = field(default_factory=list)
    pre_env: list[str] = field(default_factory=list)   # module code rendered BEFORE `env = Environment(...)`
    post_env: list[str] = field(default_factory=list)  # module code rendered AFTER (may reference `env`)
    capabilities: list[str] = field(default_factory=list)   # `Capability.xxx(...)` exprs for the constructor
    taskset_calls: list[str] = field(default_factory=list)  # concrete task call exprs for the Taskset
    py_deps: list[str] = field(default_factory=list)
    system_deps: list[str] = field(default_factory=list)
    files: dict[str, str] = field(default_factory=dict)     # extra on-disk files: relpath -> content
    env_vars: dict[str, str] = field(default_factory=dict)
    defines: list[str] = field(default_factory=list)        # top-level names this defines (collision check)
    diagnostics: list[Diagnostic] = field(default_factory=list)


@dataclass
class BuildIR:
    """The merged build — every contribution reduced into one slotted structure."""

    env_name: str
    version: str = ""
    description: str = ""
    imports: list[str] = field(default_factory=list)
    pre_env: list[str] = field(default_factory=list)
    post_env: list[str] = field(default_factory=list)
    capabilities: list[str] = field(default_factory=list)
    taskset_calls: list[str] = field(default_factory=list)
    py_deps: list[str] = field(default_factory=list)
    system_deps: list[str] = field(default_factory=list)
    files: dict[str, str] = field(default_factory=dict)
    env_vars: dict[str, str] = field(default_factory=dict)
    defines: list[str] = field(default_factory=list)
    diagnostics: list[Diagnostic] = field(default_factory=list)


@dataclass
class Codebase:
    """The rendered, deployable project: a file set + the IR + verdicts.

    `ok` is assembly soundness (compiles, no name collision, no file conflict).
    `deployable` is stricter: `ok` and no undeclared-dependency error — i.e. `hud deploy`
    should be able to build and run it.
    """

    files: dict[str, str]
    ir: BuildIR
    diagnostics: list[Diagnostic] = field(default_factory=list)
    ok: bool = True
    deployable: bool = True

    @property
    def env_py(self) -> str:
        return self.files.get("env.py", "")


# ── reduce: merge contributions into the IR ──────────────────────────────────
def _add_unique(dst: list[str], items: list[str]) -> None:
    for item in items:
        if item and item not in dst:
            dst.append(item)


def reduce_contributions(
    contributions: list[EnvContribution],
    *,
    env_name: str,
    description: str = "",
    version: str | None = None,
) -> BuildIR:
    """Merge every contribution into one BuildIR (dedup imports/deps, detect collisions)."""
    ir = BuildIR(env_name=env_name, description=description)
    ir.imports.append("from hud.environment import Environment")  # always present

    owner: dict[str, str] = {}
    for c in contributions:
        _add_unique(ir.imports, c.imports)
        ir.pre_env += [b for b in c.pre_env if b.strip()]
        ir.post_env += [b for b in c.post_env if b.strip()]
        ir.capabilities += c.capabilities
        ir.taskset_calls += c.taskset_calls
        _add_unique(ir.py_deps, c.py_deps)
        _add_unique(ir.system_deps, c.system_deps)
        ir.env_vars.update(c.env_vars)
        ir.diagnostics += c.diagnostics

        for path, content in c.files.items():
            if path in ir.files and ir.files[path] != content:
                ir.diagnostics.append(Diagnostic(
                    level="error", code="build.file_conflict",
                    message=f"Contributions {owner.get('file:' + path, '?')!r} and {c.source!r} "
                            f"write different {path!r}.",
                ))
            ir.files[path] = content
            owner.setdefault("file:" + path, c.source)

        for name in c.defines:
            if name in owner:
                ir.diagnostics.append(Diagnostic(
                    level="error", code="env.name_collision",
                    message=f"{name!r} is defined by both {owner[name]!r} and {c.source!r}; "
                            "one shadows the other in env.py.",
                ))
            else:
                owner[name] = c.source
            ir.defines.append(name)

    ir.version = version or _pin_version(ir)
    return ir


def _pin_version(ir: BuildIR) -> str:
    """A reproducible version: a content hash of the IR (no wall-clock)."""
    payload = json.dumps(
        {
            "env": ir.env_name,
            "imports": ir.imports,
            "pre_env": ir.pre_env,
            "post_env": ir.post_env,
            "calls": ir.taskset_calls,
            "capabilities": ir.capabilities,
            "defines": sorted(ir.defines),
        },
        sort_keys=True,
    )
    return "0.1.0+" + hashlib.sha256(payload.encode("utf-8")).hexdigest()[:8]


# ── render: IR → env.py source ───────────────────────────────────────────────
def _import_block(imports: list[str]) -> str:
    """Plain `import x` lines first, then `from x import y` (same module coalesced), sorted."""
    plain = sorted(i for i in imports if i.startswith("import "))

    by_module: dict[str, list[str]] = {}
    for line in imports:
        if not line.startswith("from "):
            continue
        head, _, names = line.partition(" import ")
        module = head[len("from "):].strip()
        bucket = by_module.setdefault(module, [])
        for name in names.split(","):
            name = name.strip()
            if name and name not in bucket:
                bucket.append(name)
    froms = [f"from {m} import {', '.join(sorted(by_module[m]))}" for m in sorted(by_module)]

    gap = [""] if plain and froms else []
    return "\n".join(plain + gap + froms)


def _module_docstring(ir: BuildIR) -> str:
    lines: list[str] = []
    desc = (ir.description or "").strip()
    if desc:
        lines += [desc, ""]
    lines += [
        f"AUTO-GENERATED by RL Scratch — HUD v6 environment {ir.env_name!r}.",
        f"version: {ir.version}",
        f"defines: {', '.join(ir.defines) or 'none'}",
        f"tasks:   {len(ir.taskset_calls)} concrete task(s)",
        "",
        "Serve with `hud serve env.py`; evaluate with `hud eval env.py <model>`.",
    ]
    return '"""' + "\n".join(lines).replace('"""', "'''") + '\n"""'


def _env_line(ir: BuildIR) -> str:
    args = [f"name={json.dumps(ir.env_name)}", f"version={json.dumps(ir.version)}"]
    if ir.capabilities:
        args.append(f"capabilities=[{', '.join(ir.capabilities)}]")
    return f"env = Environment({', '.join(args)})"


def _taskset_line(ir: BuildIR) -> str:
    if not ir.taskset_calls:
        return "tasks = []"
    rows = "\n".join(f"    {c}," for c in ir.taskset_calls)
    return f"tasks = Taskset({json.dumps(ir.env_name)}, [\n{rows}\n])"


def render_env_py(ir: BuildIR) -> str:
    """Render the IR into a single env.py source string (top-to-bottom resolvable)."""
    sections = [_module_docstring(ir), _import_block(ir.imports)]
    sections += ir.pre_env
    sections.append(_env_line(ir))
    sections += ir.post_env
    sections.append(_taskset_line(ir))
    return "\n\n\n".join(s for s in sections if s.strip()).rstrip() + "\n"


# ── render: IR → project files (pyproject / Dockerfile) ──────────────────────
_BASE_PY_DEPS = ["hud-python>=0.6"]            # env.py always imports `hud`
_DEP_VERSIONS = {"fastmcp": "fastmcp>=2.0", "hud-python": "hud-python>=0.6"}
_DIST_TO_IMPORT = {"hud-python": "hud"}        # dist name → import root, where they differ
_SERVE_PORT = 8765                              # the scaffolded Dockerfile.hud serves 8765


def project_dependencies(ir: BuildIR) -> list[str]:
    """The pyproject dependency list: the always-needed base + each contribution's py_deps."""
    deps = list(_BASE_PY_DEPS)
    for dep in ir.py_deps:
        spec = _DEP_VERSIONS.get(dep, dep)
        if spec not in deps:
            deps.append(spec)
    return deps


def render_pyproject(ir: BuildIR) -> str:
    dep_lines = ",\n".join(f"    {json.dumps(d)}" for d in project_dependencies(ir))
    return (
        "[project]\n"
        f"name = {json.dumps(ir.env_name)}\n"
        f"version = {json.dumps(ir.version)}\n"
        'requires-python = ">=3.12"\n'
        f"dependencies = [\n{dep_lines}\n]\n"
    )


def render_dockerfile(ir: BuildIR) -> str:
    lines = ["# syntax=docker/dockerfile:1", "FROM python:3.12-slim", ""]
    if ir.system_deps:
        pkgs = " ".join(sorted(set(ir.system_deps)))
        lines += [
            "RUN apt-get update && apt-get install -y --no-install-recommends \\",
            f"        {pkgs} \\",
            "    && rm -rf /var/lib/apt/lists/*",
            "",
        ]
    for key, value in ir.env_vars.items():
        lines.append(f"ENV {key}={json.dumps(value)}")
    if ir.env_vars:
        lines.append("")
    lines += [
        "WORKDIR /app",
        "COPY . /app",
        "RUN pip install --no-cache-dir .",
        "",
        f"EXPOSE {_SERVE_PORT}",
        f'CMD ["hud", "serve", "env.py", "--host", "0.0.0.0", "--port", "{_SERVE_PORT}"]',
        "",
    ]
    return "\n".join(lines)


# ── deployability gate: static checks that compile-only can't catch ──────────
def _import_root(line: str) -> str:
    line = line.strip()
    if line.startswith("import "):
        mod = line[len("import "):].split(",")[0]
    elif line.startswith("from "):
        mod = line[len("from "):].split(" import ")[0]
    else:
        return ""
    return mod.strip().split(".")[0].split(" as ")[0].strip()


def _provided_roots(ir: BuildIR) -> set[str]:
    roots = set(sys.stdlib_module_names)
    for dep in _BASE_PY_DEPS + ir.py_deps:
        name = re.split(r"[<>=!~;\[ ]", dep, maxsplit=1)[0].strip()
        roots.add(_DIST_TO_IMPORT.get(name, name).replace("-", "_"))
    return roots


def deployability_gate(ir: BuildIR) -> list[Diagnostic]:
    """Static checks for whether `hud deploy` can build and run this (no boot needed)."""
    diags: list[Diagnostic] = []

    # 1. every third-party import must be covered by a declared dependency, or the image
    #    build/run fails ("env imports a package hud can't find").
    provided = _provided_roots(ir)
    flagged: set[str] = set()
    for imp in ir.imports:
        root = _import_root(imp)
        if root and root not in provided and root not in flagged:
            flagged.add(root)
            diags.append(Diagnostic(
                level="error", code="deploy.undeclared_dependency",
                message=f"env.py imports {root!r} but no dependency provides it; "
                        "add it to the contributing block's py_deps.",
            ))

    # 2. the agent needs at least one capability to connect to (HUD: VITAL).
    if not ir.capabilities and "add_capability" not in "\n".join(ir.post_env):
        diags.append(Diagnostic(
            level="warn", code="deploy.no_capability",
            message="Environment exposes no capability; an agent has nothing to connect to "
                    "(add a tool or a resource).",
        ))
    return diags


# ── build: reduce → render → compile-check + deployability gate ──────────────
_BLOCKING_CODES = {"env.name_collision", "build.file_conflict", "env.syntax_error"}


def build_codebase(
    contributions: list[EnvContribution],
    *,
    env_name: str,
    description: str = "",
    version: str | None = None,
) -> Codebase:
    """Reduce contributions, render the project files, compile-check, run the deploy gate.

    Compile-check is syntax/AST only (no boot, no eval). `ok` = assembly soundness;
    `deployable` additionally requires no undeclared-dependency error.
    """
    ir = reduce_contributions(contributions, env_name=env_name, description=description, version=version)
    source = render_env_py(ir)
    diags = list(ir.diagnostics)

    try:
        compile(source, "env.py", "exec")
    except SyntaxError as exc:
        diags.append(Diagnostic(level="error", code="env.syntax_error",
                                message=f"Generated env.py does not compile: {exc}"))

    diags += deployability_gate(ir)

    ok = not any(d.level == "error" and d.code in _BLOCKING_CODES for d in diags)
    deployable = ok and not any(
        d.level == "error" and d.code == "deploy.undeclared_dependency" for d in diags
    )
    files = {
        "env.py": source,
        "pyproject.toml": render_pyproject(ir),
        "Dockerfile.hud": render_dockerfile(ir),
        **ir.files,
    }
    return Codebase(files=files, ir=ir, diagnostics=diags, ok=ok, deployable=deployable)
