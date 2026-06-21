"""
Schema-agnostic task adaptation — the task compiler's forward-compatibility layer.

The UI's JSON shape changes across versions, and the shared LLM extractor canonicalizes
to a thin `(prompt, answer_type, answer)` — which silently drops anything else. This
module is defense-in-depth for the compiler itself: it accepts ANY task-shaped object —
a canonical `TaskBlock`, a raw dict in some unknown schema, or a *custom block* the
product just invented — and normalizes it without ever crashing.

Principles:
- Lenient keys: prompt|instruction|goal|question|task|text; answer|expected|solution|
  target|output|gold; answer_type|answerType|grading|grader|mode|kind.
- Infer what's missing: no answer_type → numeric/short answer ⇒ exact, prose ⇒ state.
- Parameters survive: params|parameters|args|arguments|variables|inputs become real
  template parameters (driving Taskset expansion), as dict, list-of-dicts, or list-of-names.
- Custom blocks: a block is a task if it *looks* like one (has a prompt-ish field),
  whatever its declared `type`. Non-task blocks are skipped with a diagnostic, never an error.
- Nothing is dropped silently: unrecognized keys ride along in `extras` (fed to the LLM
  planner as context).
"""

from __future__ import annotations

import json
from typing import Any

from pydantic import BaseModel, Field

from synth.tasks.grade import parse_number, py_literal
from synth.tasks.spec import Diagnostic

ParamValue = str | int | float | bool

_PROMPT_KEYS = ["prompt", "instruction", "instructions", "goal", "question", "task", "text", "objective"]
_ANSWER_KEYS = ["answer", "expected", "expected_answer", "solution", "target", "output", "gold", "golden"]
_TYPE_KEYS = ["answer_type", "answerType", "grading", "grader", "grade_type", "mode", "kind"]
_PARAM_KEYS = ["params", "parameters", "args", "arguments", "variables", "vars", "inputs"]
_NAME_KEYS = ["name", "id", "slug", "title"]

_RECOGNIZED = set(_PROMPT_KEYS + _ANSWER_KEYS + _TYPE_KEYS + _PARAM_KEYS + _NAME_KEYS + ["type"])

_EXACT_WORDS = {"exact", "literal", "match", "deterministic", "equals", "string", "number", "numeric"}
_STATE_WORDS = {"state", "judge", "llm", "rubric", "describe", "description", "semantic", "fuzzy", "open"}

_ENV_TYPES = {"env", "environment", "stage", "world"}
_TOOL_TYPES = {"tool", "capability", "action", "function"}
_TASK_TYPES = {"task", "scenario", "goal", "challenge", "eval", "evaluation", "question"}


class NormParam(BaseModel):
    name: str
    type: str = "str"
    default: ParamValue | None = None
    values: list[ParamValue] = Field(default_factory=list)

    def annotation(self) -> str:
        if self.type in ("str", "int", "float", "bool"):
            return self.type
        return "str"

    def default_literal(self) -> str:
        if self.default is not None:
            return py_literal(self.default)
        if self.values:
            return py_literal(self.values[0])
        return {"int": "0", "float": "0.0", "bool": "False"}.get(self.type, '""')


class NormalizedTask(BaseModel):
    prompt: str
    answer_type: str  # "exact" | "state"
    answer: str = ""
    params: list[NormParam] = Field(default_factory=list)
    extras: dict[str, Any] = Field(default_factory=dict)

    @property
    def param_names(self) -> list[str]:
        return [p.name for p in self.params]


# ── helpers ───────────────────────────────────────────────────────────────
def _as_dict(obj: Any) -> dict | None:
    if isinstance(obj, BaseModel):
        return obj.model_dump()
    if isinstance(obj, dict):
        return obj
    if hasattr(obj, "__dict__"):
        return {k: v for k, v in vars(obj).items() if not k.startswith("_")}
    return None


def _get(d: dict, keys: list[str]) -> Any:
    for k in keys:
        if k in d and d[k] not in (None, ""):
            return d[k]
    return None


def _scalar(v: Any) -> ParamValue:
    return v if isinstance(v, (str, int, float, bool)) else str(v)


def _infer_type(v: ParamValue) -> str:
    if isinstance(v, bool):
        return "bool"
    if isinstance(v, int):
        return "int"
    if isinstance(v, float):
        return "float"
    return "str"


def _coerce_answer_type(raw: Any, answer: str) -> str:
    if raw is not None:
        v = str(raw).strip().lower()
        if any(w in v for w in _STATE_WORDS):
            return "state"
        if any(w in v for w in _EXACT_WORDS):
            return "exact"
    a = (answer or "").strip()
    if not a:
        return "state"  # nothing literal to match against → let a judge decide
    if parse_number(a) is not None:
        return "exact"
    return "exact" if (len(a) <= 40 and a.count(" ") <= 5) else "state"


def _param_from_dict(d: dict) -> NormParam | None:
    name = _get(d, _NAME_KEYS)
    if not name or not str(name).isidentifier():
        return None
    values = d.get("values") or d.get("options") or d.get("choices") or []
    values = [_scalar(x) for x in values if x is not None] if isinstance(values, list) else []
    default = d.get("default", d.get("value"))
    default = _scalar(default) if default is not None else None
    ptype = d.get("type")
    if ptype not in ("str", "int", "float", "bool"):
        sample = default if default is not None else (values[0] if values else None)
        ptype = _infer_type(sample) if sample is not None else "str"
    return NormParam(name=str(name), type=ptype, default=default, values=values)


def normalize_params(raw: Any) -> list[NormParam]:
    out: list[NormParam] = []
    if not raw:
        return out
    if isinstance(raw, dict):
        for name, v in raw.items():
            if not str(name).isidentifier():
                continue
            if isinstance(v, list):
                vals = [_scalar(x) for x in v if x is not None]
                out.append(NormParam(name=name, type=_infer_type(vals[0]) if vals else "str", values=vals))
            elif isinstance(v, dict):
                p = _param_from_dict({"name": name, **v})
                if p:
                    out.append(p)
            else:
                out.append(NormParam(name=name, type=_infer_type(_scalar(v)), default=_scalar(v)))
    elif isinstance(raw, list):
        for item in raw:
            if isinstance(item, str) and item.isidentifier():
                out.append(NormParam(name=item))
            elif isinstance(item, dict):
                p = _param_from_dict(item)
                if p:
                    out.append(p)
    return out


def normalize_task(obj: Any) -> NormalizedTask | None:
    """Normalize one task-shaped object, or None if it has no prompt-like content."""
    d = _as_dict(obj)
    if d is None:
        return None
    prompt = _get(d, _PROMPT_KEYS)
    if not prompt or not str(prompt).strip():
        return None
    answer = _get(d, _ANSWER_KEYS)
    answer = str(answer) if answer is not None else ""
    answer_type = _coerce_answer_type(_get(d, _TYPE_KEYS), answer)
    params = normalize_params(_get(d, _PARAM_KEYS))
    extras = {k: v for k, v in d.items() if k not in _RECOGNIZED}
    return NormalizedTask(
        prompt=str(prompt), answer_type=answer_type, answer=answer, params=params, extras=extras
    )


# ── block-level adaptation (handles custom/unknown block types) ─────────────
def _collect_blocks(raw: Any) -> tuple[list[Any], str | None, set[str]]:
    """Return (task-ish blocks, env name if found, tool names if found).

    Handles every shape: a grouped {env, tools, tasks, custom}, a {blocks|nodes: [...]}
    list, a flat block list, or a single bare task dict — combining all sources and
    pulling env/tool blocks out so only task candidates remain.
    """
    if isinstance(raw, str):
        raw = json.loads(raw)
    if isinstance(raw, BaseModel):  # a ProjectSpec or similar
        raw = raw.model_dump()

    env_name: str | None = None
    tool_names: set[str] = set()
    candidates: list[Any] = []

    if isinstance(raw, dict):
        env = raw.get("env")
        if isinstance(env, dict):
            env_name = env.get("name")
        elif isinstance(env, str):
            env_name = env
        for t in raw.get("tools", []) or []:
            nm = t.get("name") if isinstance(t, dict) else None
            if nm:
                tool_names.add(str(nm))
        lst = raw.get("blocks") or raw.get("nodes")
        if isinstance(lst, list):
            candidates += lst
        candidates += list(raw.get("tasks", [])) + list(raw.get("custom", []))
        if not candidates and not raw.get("tools") and not raw.get("env"):
            candidates = [raw]  # a single bare task dict
    elif isinstance(raw, list):
        candidates = raw
    else:
        return [], None, set()

    # partition: env/tool blocks contribute names; everything else is a task candidate
    blocks: list[Any] = []
    for b in candidates:
        t = str((b.get("type") if isinstance(b, dict) else "") or "").lower()
        if t in _ENV_TYPES:
            nm = b.get("name") if isinstance(b, dict) else None
            env_name = env_name or (str(nm) if nm else None)
        elif t in _TOOL_TYPES:
            nm = b.get("name") if isinstance(b, dict) else None
            if nm:
                tool_names.add(str(nm))
        else:
            blocks.append(b)
    return blocks, env_name, tool_names


def adapt_tasks(raw: Any) -> tuple[list[NormalizedTask], str | None, set[str], list[Diagnostic]]:
    """Schema-agnostic: any raw JSON/blocks → normalized tasks + env name + tool names + diagnostics."""
    diags: list[Diagnostic] = []
    try:
        blocks, env_name, tool_names = _collect_blocks(raw)
    except Exception as exc:  # noqa: BLE001 - malformed input must not crash the compiler
        return [], None, set(), [Diagnostic(level="error", code="adapt.unreadable",
                                             message=f"Could not read the project JSON: {exc!r}")]

    tasks: list[NormalizedTask] = []
    for i, b in enumerate(blocks):
        declared = str((b.get("type") if isinstance(b, dict) else "") or "").lower()
        nt = normalize_task(b)
        if nt is not None:
            tasks.append(nt)
        elif declared in _TASK_TYPES:
            diags.append(Diagnostic(level="warn", code="task.unparseable",
                                    message=f"Block #{i} is typed as a task but has no recognizable prompt; skipped."))
        elif declared and declared not in _ENV_TYPES | _TOOL_TYPES:
            diags.append(Diagnostic(level="info", code="block.skipped_unknown",
                                    message=f"Skipped block #{i} of unknown type {declared!r} (no task content)."))
    return tasks, env_name, tool_names, diags
