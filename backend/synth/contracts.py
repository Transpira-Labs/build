"""
Shared data contracts for the RL Scratch backend pipeline.

The pipeline is:

    v1 JSON ─▶ [1 validate&group] ─▶ ProjectSpec ─┬─▶ [2 tool synth]  ─▶ SynthesizedTool(s)
                                                  └─▶ [3 tasks synth] ─▶ Scenario(s)
                                       ─▶ [4 compile] ─▶ env.py ─▶ HUD

This module holds the **input** side (the v1 blocks, shared by every step) and the
**tool synthesizer's output** (`SynthesizedTool`). The tasks synthesizer owns its own
output type. Everything here is plain Pydantic v2 and round-trips to JSON.

### Schema tolerance (important)

The UI's JSON shape changes between versions and may add custom block types or extra
fields. So the input models are deliberately *forgiving*:

- every input block allows **extra fields** (`extra="allow"`) — unknown keys are kept,
  never dropped, so later steps can use them;
- `ToolBlock.params` and `TaskBlock.args` capture richer schemas that specify explicit
  parameters/arguments;
- `answer_type` is *coerced* — an unrecognized grading type degrades to a valid one
  instead of raising;
- `ProjectSpec.custom` preserves any block that doesn't map to env/tool/task;
- `ProjectSpec.from_v1` never crashes on a missing key or an unknown block type.

Keep the existing fields/aliases stable (both synthesizers depend on them); only ever
*add* to this file.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

ParamType = Literal["string", "integer", "number", "boolean"]
AnswerType = Literal["exact", "state"]

# Unknown/custom grading types degrade to one of the two canonical regimes.
_STATE_ALIASES = {
    "state", "judge", "llm", "llm_judge", "rubric", "description",
    "subjective", "semantic", "fuzzy", "criteria", "goal",
}


class ToolParam(BaseModel):
    name: str
    type: ParamType = "string"
    description: str = ""
    required: bool = True


# ── input: the v1 blocks (all extra-tolerant) ───────────────────────────────
class EnvBlock(BaseModel):
    model_config = ConfigDict(extra="allow")

    name: str = "env"
    description: str = ""


class ToolBlock(BaseModel):
    """A v1 tool: a name + an English sentence. Richer schemas may add params/extra."""

    model_config = ConfigDict(extra="allow")

    name: str
    functionality: str = Field(default="", description="plain-English description of the tool")
    params: list[ToolParam] = Field(
        default_factory=list,
        description="explicit params if the source schema provides them (optional)",
    )


class TaskBlock(BaseModel):
    """A v1 task: prompt + how it's graded + the user's answer. Extra args preserved."""

    model_config = ConfigDict(populate_by_name=True, extra="allow")

    prompt: str
    answer_type: AnswerType = Field(default="exact", alias="answerType")
    answer: str = ""
    args: dict[str, Any] = Field(
        default_factory=dict, description="extra task arguments/parameters from richer schemas"
    )

    @field_validator("answer_type", mode="before")
    @classmethod
    def _coerce_answer_type(cls, v: Any) -> str:
        if v is None:
            return "exact"
        s = str(v).strip().lower()
        if s in ("exact", "state"):
            return s
        return "state" if s in _STATE_ALIASES else "exact"


class ProjectSpec(BaseModel):
    """The grouped, normalized structure produced by extraction/step 1."""

    model_config = ConfigDict(extra="allow")

    env: EnvBlock
    tools: list[ToolBlock] = Field(default_factory=list)
    tasks: list[TaskBlock] = Field(default_factory=list)
    custom: list[dict[str, Any]] = Field(
        default_factory=list,
        description="blocks that didn't map to env/tool/task — preserved, never dropped",
    )

    @model_validator(mode="after")
    def _dedup_tools(self) -> "ProjectSpec":
        # Don't crash on a duplicate tool name (a quirky schema shouldn't fail the run);
        # keep the first occurrence.
        seen: set[str] = set()
        kept: list[ToolBlock] = []
        for t in self.tools:
            if t.name in seen:
                continue
            seen.add(t.name)
            kept.append(t)
        self.tools = kept
        return self

    @classmethod
    def from_v1(cls, data: dict | list) -> "ProjectSpec":
        """Heuristic, schema-tolerant parse of arbitrary project JSON.

        Used as the offline fallback when the LLM extractor is unavailable. Accepts a
        grouped object or a flat block list, infers a block's kind when `type` is
        missing, preserves extra fields, and routes anything unrecognized to `custom`.
        Never raises on missing keys or unknown block types.
        """
        if isinstance(data, dict) and "tools" in data and "env" in data:
            try:
                return cls.model_validate(data)
            except Exception:  # noqa: BLE001 - fall through to lenient block parsing
                pass

        if isinstance(data, dict):
            blocks = data.get("blocks") or data.get("nodes") or []
        else:
            blocks = data
        if not isinstance(blocks, list):
            blocks = []

        env: EnvBlock | None = None
        tools: list[ToolBlock] = []
        tasks: list[TaskBlock] = []
        custom: list[dict[str, Any]] = []

        for b in blocks:
            if not isinstance(b, dict):
                custom.append({"value": b})
                continue
            kind = _infer_kind(b)
            payload = {k: v for k, v in b.items() if k != "type"}
            try:
                if kind == "env":
                    env = EnvBlock.model_validate(payload)
                elif kind == "tool":
                    payload.setdefault("functionality", b.get("description", ""))
                    tools.append(ToolBlock.model_validate(payload))
                elif kind == "task":
                    tasks.append(TaskBlock.model_validate(payload))
                else:
                    custom.append(b)
            except Exception:  # noqa: BLE001 - a malformed block is preserved, not fatal
                custom.append(b)

        return cls(env=env or EnvBlock(), tools=tools, tasks=tasks, custom=custom)


def _infer_kind(b: dict) -> str:
    """Classify a block by its declared type, else by the shape of its keys."""
    declared = str(b.get("type") or b.get("kind") or "").strip().lower()
    if declared:
        # An explicit type is authoritative — an unrecognized one is custom, never guessed.
        if declared in ("env", "environment"):
            return "env"
        if declared in ("tool", "capability", "action"):
            return "tool"
        if declared in ("task", "scenario", "eval"):
            return "task"
        return "custom"

    # No declared type — infer from the shape of the keys.
    if "prompt" in b or "answer" in b or "answerType" in b or "answer_type" in b:
        return "task"
    if "functionality" in b:
        return "tool"
    if "name" in b and {"name", "description"} >= set(b.keys()):
        return "env"
    if "name" in b:
        return "tool"
    return "custom"


# ── output: the tool synthesizer's product ──────────────────────────────────
SmokeStatus = Literal["passed", "compiled", "failed", "skipped"]


class SmokeResult(BaseModel):
    """Outcome of compile-checking a synthesized tool.

    - passed   : compiled and ran on a safe sample (not used in the compile-only path).
    - compiled : source compiles; execution deferred (e.g. risky tool → HUD sandbox).
    - failed   : did not compile.
    - skipped  : not checked.
    """

    status: SmokeStatus = "skipped"
    detail: str = ""

    @property
    def ok(self) -> bool:
        return self.status in ("passed", "compiled")


class SynthesizedTool(BaseModel):
    """Runnable Python for one tool, plus how it was made and whether it's safe."""

    name: str
    description: str = ""
    params: list[ToolParam] = Field(default_factory=list)
    source: str = Field(description="a self-contained python `def <name>(...)` (with imports)")
    origin: str = Field(description="'template:<name>', 'llm', or 'stub'")
    needs_sandbox: bool = Field(
        default=False,
        description="runs code / hits network / touches the fs — execute only in HUD's sandbox",
    )
    smoke: SmokeResult = Field(default_factory=SmokeResult)

    @model_validator(mode="after")
    def _valid_name(self) -> "SynthesizedTool":
        if not self.name.isidentifier():
            raise ValueError(f"tool name {self.name!r} is not a valid identifier")
        return self


class SynthesizedToolset(BaseModel):
    """The tool synthesizer's full output for one project (handoff to step 4)."""

    env_name: str
    tools: list[SynthesizedTool] = Field(default_factory=list)
    meta: dict[str, Any] = Field(default_factory=dict)
