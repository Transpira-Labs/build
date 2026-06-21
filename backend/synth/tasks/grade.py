"""
Reward rendering — canonical grader code from a grading decision.

A `ScenarioPlan` (decided by the LLM or the deterministic fallback) is rendered into
the grading tail of an `@env.template()`:

  deterministic → numeric_match for numeric golden answers (so "1024" == "1024.0"),
                  else exact_match OR contains for text (lenient to phrasing, strict
                  on content). No model, nothing to reward-hack, ~free.

  llm_judge     → LLMJudgeGrader scores the agent's outcome against the rubric, using
                  a judge model that must differ from the agent model.

Prompts, expected values, and criteria may reference task PARAMETERS as `{name}` — when
they do, the literal is emitted as an f-string so one template spans many concrete tasks.

`score_exact` is the runtime twin of the deterministic expression, so the smoke check
and the generated code can never drift. The rendering is canonical on purpose: the
model decides *what* to grade, never writes the reward code itself.
"""

from __future__ import annotations

import json
import re

from hud.graders import contains, exact_match, numeric_match

#: default judge model for llm_judge tasks — cheap and distinct from a frontier agent
DEFAULT_JUDGE_MODEL = "claude-haiku-4-5"

_TOKEN = re.compile(r"\{([a-zA-Z_][a-zA-Z0-9_]*)\}")


def py_str(s: str) -> str:
    """A valid python string literal (handles quotes, newlines, unicode)."""
    return json.dumps(s, ensure_ascii=False)


def py_literal(v) -> str:
    """A python literal for a scalar parameter value."""
    if isinstance(v, bool):
        return "True" if v else "False"
    if isinstance(v, (int, float)):
        return repr(v)
    return py_str("" if v is None else str(v))


def references(s: str | None, names) -> bool:
    """Does `s` contain a `{name}` token for one of `names`?"""
    if not s or not names:
        return False
    want = set(names)
    return any(m.group(1) in want for m in _TOKEN.finditer(s))


def string_literal(s: str, param_names=()) -> str:
    """A python string literal — an f-string when it references a parameter."""
    return ("f" + py_str(s)) if references(s, param_names) else py_str(s)


def parse_number(s: str | None) -> float | None:
    """Return the answer as a float if it is purely numeric, else None."""
    if s is None:
        return None
    try:
        return float(s.strip().replace(",", ""))
    except (TypeError, ValueError):
        return None


# ── runtime grader (single source of truth, used by the smoke check) ─────────
def score_exact(answer: str, expected: str, match: str = "auto") -> float:
    """Deterministically score `answer` against the literal `expected`.

    Mirrors exactly what `emit_exact_grader` writes into env.py.
    """
    num = parse_number(expected) if match in ("auto", "numeric") else None
    if num is not None:
        return numeric_match(answer, num)
    return max(exact_match(answer, expected), contains(answer, expected))


def corrupt(expected: str) -> str:
    """A wrong answer used by the smoke check (must score 0 against a sane grader)."""
    num = parse_number(expected)
    if num is not None:
        return str(num + 1.0)
    return "__rl_scratch_definitely_wrong__"


# ── emitters (the canonical grader body) ─────────────────────────────────────
class GraderEmit:
    def __init__(self, symbols: list[str], body: list[str]):
        self.symbols = symbols
        self.body = body


def emit_exact_grader(expected: str, match: str = "auto", param_names=(), indent: str = "    ") -> GraderEmit:
    """Deterministic comparison against a literal (or parameter-templated) golden answer."""
    templated = references(expected, param_names)
    num = parse_number(expected) if match in ("auto", "numeric") and not templated else None
    if num is not None:
        return GraderEmit(["numeric_match"], [f"{indent}yield numeric_match(answer, {num!r})"])
    lit = string_literal(expected.strip(), param_names)
    return GraderEmit(
        ["exact_match", "contains"],
        [f"{indent}yield max(exact_match(answer, {lit}), contains(answer, {lit}))"],
    )


def emit_state_grader(
    criteria: list[str], judge_model: str = DEFAULT_JUDGE_MODEL, param_names=(), indent: str = "    "
) -> GraderEmit:
    """LLM judge scoring the agent's outcome against one or more rubric criteria."""
    items = [string_literal(c.strip(), param_names) for c in criteria if c and c.strip()] or ['""']
    body = [
        f"{indent}result = await LLMJudgeGrader.grade(",
        f"{indent}    weight=1.0,",
        f"{indent}    answer=answer,",
        f"{indent}    question=prompt,",
        f"{indent}    criteria=[{', '.join(items)}],",
        f"{indent}    model={py_str(judge_model)},",
        f"{indent})",
        f"{indent}yield result.value",
    ]
    return GraderEmit(["LLMJudgeGrader"], body)


def build_template_source(
    env_var: str, task_id: str, fn_name: str, prompt: str, grader_body: list[str],
    signature: str = "", param_names=(),
) -> str:
    """Wrap a grader body into a complete `@env.template()` async generator."""
    return "\n".join(
        [
            f"@{env_var}.template(id={py_str(task_id)})",
            f"async def {fn_name}({signature}):",
            f"    prompt = {string_literal(prompt, param_names)}",
            "    answer = yield prompt",
            *grader_body,
        ]
    )


def render_plan(plan, judge_model: str, param_names=()) -> tuple[list[str], list[str], str]:
    """Render a ScenarioPlan into (grader_body, import_lines, grading_mode)."""
    if plan.mode == "deterministic":
        g = emit_exact_grader(plan.expected or "", match=plan.match, param_names=param_names)
        imports = [f"from hud.graders import {', '.join(sorted(set(g.symbols)))}"]
        return g.body, imports, "deterministic"
    g = emit_state_grader(plan.criteria, judge_model=judge_model, param_names=param_names)
    return g.body, ["from hud.graders import LLMJudgeGrader"], "llm_judge"
