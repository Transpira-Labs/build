// ─────────────────────────────────────────────────────────────────────────
// Task synthesizer
//
// Turns the RL Scratch UI's JSON (`EnvJSON`) into the *task* half of a HUD v6
// environment: one `@env.template()` async-generator per task block, plus the
// `Taskset` that collects them.
//
// Scope: this module owns ONLY task blocks (`type: "task"`). Tool blocks
// (capabilities + the `Environment(...)` line) are the tool synthesizer's job,
// so they're treated as opaque here. The two halves meet in an assembler that
// unions `imports` and concatenates the emitted source.
//
// Everything maps to documented HUD v6 primitives (see docs.hud.ai):
//   • a task is an async generator with two yields: a prompt, then a reward 0-1
//   • graders: LLMJudgeGrader, BashGrader, exact_match/contains/numeric_match,
//     combine(...) + SubScore for composed rewards
//   • one template + parameters → a whole space of tasks (needed for RL spread)
// ─────────────────────────────────────────────────────────────────────────

// ── JSON contract (the part the task synthesizer reads) ───────────────────

export interface EnvJSON {
  name: string;
  children: ChildBlock[];
  /** optional explicit taskset name; defaults to the env name */
  taskset?: string;
}

export type ChildBlock = TaskBlock | OpaqueBlock;

/** Tool / unknown blocks belong to other synthesizers; kept opaque on purpose. */
export interface OpaqueBlock {
  id: string;
  type: string;
  [k: string]: unknown;
}

export interface TaskBlock {
  id: string;
  type: "task";
  name: string;
  prompt: string;
  /** parameters turn one task into a template family (difficulty/seed variety) */
  params?: TaskParam[];
  reward: RewardSpec | LegacyReward;
}

export type ParamValue = string | number | boolean;

export interface TaskParam {
  name: string;
  type?: "str" | "int" | "float" | "bool";
  default?: ParamValue;
  /** when present, the taskset expands across these values (cartesian product) */
  values?: ParamValue[];
}

// ── Rewards → HUD graders ─────────────────────────────────────────────────

export type RewardSpec =
  | LLMJudgeReward
  | ExactMatchReward
  | ContainsReward
  | NumericMatchReward
  | BashReward
  | CombineReward
  | CustomReward;

export interface JudgeCriterion {
  text: string;
  weight?: number;
}
export interface LLMJudgeReward {
  kind: "llm_judge";
  criteria: string | JudgeCriterion[];
  model?: string;
}
export interface ExactMatchReward {
  kind: "exact_match";
  expected: string;
}
export interface ContainsReward {
  kind: "contains";
  expected: string | string[];
  mode?: "any" | "all"; // for a list of substrings
}
export interface NumericMatchReward {
  kind: "numeric_match";
  expected: number | string;
  tolerance?: number;
}
export interface BashReward {
  kind: "bash";
  command: string;
  cwd?: string;
}
export interface WeightedReward {
  weight: number;
  reward: RewardSpec;
}
export interface CombineReward {
  kind: "combine";
  parts: WeightedReward[];
}
export interface CustomReward {
  kind: "custom";
  code?: string; // python body; receives `answer`, must end by yielding a float
}

/** Legacy UI shape (current export): `{ kind, criteria }`. Normalized below. */
export interface LegacyReward {
  kind: "llm_judge" | "exact_match" | "custom";
  criteria: string;
}

// ── Synthesizer output ────────────────────────────────────────────────────

export interface Diagnostic {
  level: "error" | "warn" | "info";
  code: string;
  message: string;
  taskId?: string;
}

export interface TaskSynthResult {
  /** python import lines this half needs (graders + Taskset), deduped & sorted */
  imports: string[];
  /** one `@env.template()` def per task block, in source order */
  functions: string[];
  /** the `Taskset(...)` (or plain list) assembling every concrete task */
  taskset: string;
  /** number of concrete tasks after parameter expansion */
  taskCount: number;
  diagnostics: Diagnostic[];
}

export interface SynthOptions {
  /** name of the Environment object the @decorator hangs off (tool synth owns it) */
  envVar?: string;
  /** override the taskset name; defaults to env.taskset ?? env.name */
  tasksetName?: string;
  /** "taskset" → `Taskset(name, [...])`; "list" → bare `tasks = [...]` */
  collect?: "taskset" | "list";
}

// ─────────────────────────────────────────────────────────────────────────
// Python emission helpers
// ─────────────────────────────────────────────────────────────────────────

const PY_KEYWORDS = new Set([
  "False", "None", "True", "and", "as", "assert", "async", "await", "break",
  "class", "continue", "def", "del", "elif", "else", "except", "finally",
  "for", "from", "global", "if", "import", "in", "is", "lambda", "nonlocal",
  "not", "or", "pass", "raise", "return", "try", "while", "with", "yield",
]);

/** a safe python identifier from arbitrary text, with a fallback */
function pyName(s: string, fallback: string): string {
  let clean = (s ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!clean) clean = fallback;
  if (/^[0-9]/.test(clean)) clean = `t_${clean}`;
  if (PY_KEYWORDS.has(clean)) clean = `${clean}_`;
  return clean;
}

/** a python string literal (double-quoted, properly escaped) */
function pyStr(s: string): string {
  return JSON.stringify(s ?? "");
}

/** a python literal for a parameter/scalar value */
function pyLiteral(v: ParamValue): string {
  if (typeof v === "boolean") return v ? "True" : "False";
  if (typeof v === "number") return String(v);
  return pyStr(v);
}

const INDENT = "    ";

// ─────────────────────────────────────────────────────────────────────────
// Reward normalization (legacy → rich) + grader emission
// ─────────────────────────────────────────────────────────────────────────

function isLegacy(r: RewardSpec | LegacyReward): r is LegacyReward {
  return (
    (r.kind === "llm_judge" || r.kind === "exact_match" || r.kind === "custom") &&
    "criteria" in r &&
    !("expected" in r) &&
    !("command" in r) &&
    !("parts" in r) &&
    !("code" in r)
  );
}

/** Map the current UI's `{kind, criteria}` onto the rich RewardSpec. */
function normalizeReward(r: RewardSpec | LegacyReward): RewardSpec {
  if (!isLegacy(r)) return r as RewardSpec;
  switch (r.kind) {
    case "llm_judge":
      return { kind: "llm_judge", criteria: r.criteria };
    case "exact_match":
      return { kind: "exact_match", expected: r.criteria };
    case "custom":
      return { kind: "custom", code: r.criteria || undefined };
  }
}

interface GraderEmit {
  /** symbols imported from hud.graders */
  graderSymbols: string[];
  /** whether the grader reads the agent's `answer` (drives the first yield form) */
  usesAnswer: boolean;
  /** indented python lines producing the final `yield <reward>` */
  lines: string[];
  diagnostics: Omit<Diagnostic, "taskId">[];
}

/** Emit the grading tail for a reward, at the given indent depth. */
function emitGrader(
  reward: RewardSpec,
  promptVar: string,
  depth = 1,
): GraderEmit {
  const pad = INDENT.repeat(depth);
  const symbols: string[] = [];
  const diags: Omit<Diagnostic, "taskId">[] = [];
  const lines: string[] = [];

  switch (reward.kind) {
    case "llm_judge": {
      symbols.push("LLMJudgeGrader");
      const crits = normalizeCriteria(reward.criteria);
      if (crits.length === 0) {
        diags.push({
          level: "error",
          code: "judge.no_criteria",
          message: "LLM-judge reward has no criteria; it cannot separate good work from bad.",
        });
      }
      const critItems = crits.map((c) =>
        c.weight != null ? `(${pyStr(c.text)}, ${c.weight})` : pyStr(c.text),
      );
      lines.push(`${pad}result = await LLMJudgeGrader.grade(`);
      lines.push(`${pad}${INDENT}answer=answer,`);
      lines.push(`${pad}${INDENT}question=${promptVar},`);
      lines.push(`${pad}${INDENT}criteria=[${critItems.join(", ")}],`);
      if (reward.model) lines.push(`${pad}${INDENT}model=${pyStr(reward.model)},`);
      lines.push(`${pad})`);
      lines.push(`${pad}yield result.value`);
      return { graderSymbols: symbols, usesAnswer: true, lines, diagnostics: diags };
    }

    case "exact_match": {
      symbols.push("exact_match");
      if (!reward.expected) {
        diags.push({
          level: "error",
          code: "exact.no_expected",
          message: "Exact-match reward has no expected value; every answer would score 0.",
        });
      }
      diags.push(surfaceFormWarning("exact_match"));
      lines.push(`${pad}yield exact_match(answer, ${pyStr(reward.expected ?? "")})`);
      return { graderSymbols: symbols, usesAnswer: true, lines, diagnostics: diags };
    }

    case "contains": {
      const list = Array.isArray(reward.expected) ? reward.expected : [reward.expected];
      if (list.length === 0 || list.every((s) => !s)) {
        diags.push({
          level: "error",
          code: "contains.no_target",
          message: "Contains reward has no substring to look for.",
        });
      }
      diags.push(surfaceFormWarning("contains"));
      if (list.length === 1) {
        symbols.push("contains");
        lines.push(`${pad}yield contains(answer, ${pyStr(list[0] ?? "")})`);
      } else {
        const fn = reward.mode === "all" ? "contains_all" : "contains_any";
        symbols.push(fn);
        lines.push(`${pad}yield ${fn}(answer, [${list.map(pyStr).join(", ")}])`);
      }
      return { graderSymbols: symbols, usesAnswer: true, lines, diagnostics: diags };
    }

    case "numeric_match": {
      symbols.push("numeric_match");
      const exp =
        typeof reward.expected === "number"
          ? String(reward.expected)
          : pyStr(String(reward.expected ?? ""));
      const tol = reward.tolerance != null ? `, tolerance=${reward.tolerance}` : "";
      lines.push(`${pad}yield numeric_match(answer, ${exp}${tol})`);
      return { graderSymbols: symbols, usesAnswer: true, lines, diagnostics: diags };
    }

    case "bash": {
      symbols.push("BashGrader");
      if (!reward.command) {
        diags.push({
          level: "error",
          code: "bash.no_command",
          message: "Bash reward has no command; nothing is checked.",
        });
      }
      const cwd = reward.cwd ? `, cwd=${pyStr(reward.cwd)}` : "";
      lines.push(`${pad}result = await BashGrader.grade(command=${pyStr(reward.command ?? "")}${cwd})`);
      lines.push(`${pad}yield result.value`);
      // grading the world is the strongest signal — no surface-form warning here
      return { graderSymbols: symbols, usesAnswer: false, lines, diagnostics: diags };
    }

    case "combine": {
      symbols.push("combine");
      if (!reward.parts || reward.parts.length === 0) {
        diags.push({
          level: "error",
          code: "combine.empty",
          message: "Combine reward has no parts to combine.",
        });
        lines.push(`${pad}yield 0.0`);
        return { graderSymbols: symbols, usesAnswer: false, lines, diagnostics: diags };
      }
      let usesAnswer = false;
      const items: string[] = [];
      for (const part of reward.parts) {
        const sub = normalizeReward(part.reward);
        const piece = emitCombinePart(sub, part.weight, symbols, diags);
        if (piece.usesAnswer) usesAnswer = true;
        items.push(piece.expr);
      }
      lines.push(`${pad}yield await combine(`);
      for (const it of items) lines.push(`${pad}${INDENT}${it},`);
      lines.push(`${pad})`);
      return { graderSymbols: symbols, usesAnswer, lines, diagnostics: diags };
    }

    case "custom": {
      diags.push({
        level: "info",
        code: "custom.review",
        message:
          "Custom grader: make sure its cheapest path scores at or below the floor (no constant/echo passes).",
      });
      if (reward.code && reward.code.trim()) {
        for (const raw of reward.code.replace(/\r/g, "").split("\n")) {
          lines.push(raw ? `${pad}${raw}` : "");
        }
      } else {
        lines.push(`${pad}# TODO: score \`answer\` (the agent's submission) as a float 0.0-1.0.`);
        lines.push(`${pad}yield 1.0 if answer else 0.0`);
      }
      return { graderSymbols: symbols, usesAnswer: true, lines, diagnostics: diags };
    }
  }
}

/** A single component inside `combine(...)`. Comparison helpers get wrapped in SubScore. */
function emitCombinePart(
  reward: RewardSpec,
  weight: number,
  symbols: string[],
  diags: Omit<Diagnostic, "taskId">[],
): { expr: string; usesAnswer: boolean } {
  switch (reward.kind) {
    case "llm_judge": {
      symbols.push("LLMJudgeGrader");
      const crits = normalizeCriteria(reward.criteria).map((c) =>
        c.weight != null ? `(${pyStr(c.text)}, ${c.weight})` : pyStr(c.text),
      );
      return {
        expr: `LLMJudgeGrader.grade(weight=${weight}, answer=answer, criteria=[${crits.join(", ")}])`,
        usesAnswer: true,
      };
    }
    case "bash": {
      symbols.push("BashGrader");
      const cwd = reward.cwd ? `, cwd=${pyStr(reward.cwd)}` : "";
      return {
        expr: `BashGrader.grade(weight=${weight}, command=${pyStr(reward.command ?? "")}${cwd})`,
        usesAnswer: false,
      };
    }
    case "exact_match": {
      symbols.push("SubScore", "exact_match");
      diags.push(surfaceFormWarning("exact_match"));
      return {
        expr: `SubScore(name="exact", value=exact_match(answer, ${pyStr(reward.expected ?? "")}), weight=${weight})`,
        usesAnswer: true,
      };
    }
    case "contains": {
      const list = Array.isArray(reward.expected) ? reward.expected : [reward.expected];
      symbols.push("SubScore");
      let value: string;
      if (list.length === 1) {
        symbols.push("contains");
        value = `contains(answer, ${pyStr(list[0] ?? "")})`;
      } else {
        const fn = reward.mode === "all" ? "contains_all" : "contains_any";
        symbols.push(fn);
        value = `${fn}(answer, [${list.map(pyStr).join(", ")}])`;
      }
      return { expr: `SubScore(name="contains", value=${value}, weight=${weight})`, usesAnswer: true };
    }
    case "numeric_match": {
      symbols.push("SubScore", "numeric_match");
      const exp =
        typeof reward.expected === "number"
          ? String(reward.expected)
          : pyStr(String(reward.expected ?? ""));
      const tol = reward.tolerance != null ? `, tolerance=${reward.tolerance}` : "";
      return {
        expr: `SubScore(name="numeric", value=numeric_match(answer, ${exp}${tol}), weight=${weight})`,
        usesAnswer: true,
      };
    }
    default:
      // combine/custom nested inside combine: not supported — flag and drop to 0
      diags.push({
        level: "warn",
        code: "combine.unsupported_part",
        message: `Reward kind "${reward.kind}" can't be nested inside combine; skipped.`,
      });
      symbols.push("SubScore");
      return { expr: `SubScore(name="skipped", value=0.0, weight=${weight})`, usesAnswer: false };
  }
}

function surfaceFormWarning(kind: string): Omit<Diagnostic, "taskId"> {
  return {
    level: "warn",
    code: "grader.surface_form",
    message:
      `"${kind}" grades the surface form of the answer and is easy to reward-hack. ` +
      "For open-ended work prefer an LLM judge; for real tasks grade the world (bash).",
  };
}

function normalizeCriteria(c: string | JudgeCriterion[]): JudgeCriterion[] {
  if (Array.isArray(c)) return c.filter((x) => x && x.text);
  const t = (c ?? "").trim();
  return t ? [{ text: t }] : [];
}

// ─────────────────────────────────────────────────────────────────────────
// Task function emission
// ─────────────────────────────────────────────────────────────────────────

const PARAM_TOKEN = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;

function paramType(p: TaskParam): string {
  if (p.type) return { str: "str", int: "int", float: "float", bool: "bool" }[p.type];
  if (typeof p.default === "number") return Number.isInteger(p.default) ? "int" : "float";
  if (typeof p.default === "boolean") return "bool";
  return "str";
}

function paramDefault(p: TaskParam): string {
  if (p.default !== undefined) return pyLiteral(p.default);
  if (p.values && p.values.length) return pyLiteral(p.values[0]);
  // fall back to an empty value of the right type
  const t = paramType(p);
  return t === "int" || t === "float" ? "0" : t === "bool" ? "False" : '""';
}

interface EmittedTask {
  fn: string; // python function name (unique)
  source: string;
  graderSymbols: string[];
  diagnostics: Diagnostic[];
}

function emitTask(task: TaskBlock, index: number, fnName: string): EmittedTask {
  const params = task.params ?? [];
  const reward = normalizeReward(task.reward);
  const diagnostics: Diagnostic[] = [];

  // prompt: use an f-string only when it references a declared parameter
  const declared = new Set(params.map((p) => p.name));
  const referenced = new Set<string>();
  let m: RegExpExecArray | null;
  PARAM_TOKEN.lastIndex = 0;
  while ((m = PARAM_TOKEN.exec(task.prompt ?? "")) !== null) {
    if (declared.has(m[1])) referenced.add(m[1]);
  }
  const promptExpr = referenced.size > 0 ? `f${pyStr(task.prompt ?? "")}` : pyStr(task.prompt ?? "");
  if (!task.prompt || !task.prompt.trim()) {
    diagnostics.push({
      level: "warn",
      code: "task.empty_prompt",
      taskId: task.id,
      message: "Task has no prompt; the agent is given nothing to do.",
    });
  }

  const grader = emitGrader(reward, "prompt", 1);
  for (const d of grader.diagnostics) diagnostics.push({ ...d, taskId: task.id });

  // signature
  const sig = params
    .map((p) => `${pyName(p.name, p.name)}: ${paramType(p)} = ${paramDefault(p)}`)
    .join(", ");

  // body only — the caller prepends the `@env.template()` decorator
  const lines: string[] = [];
  lines.push(`async def ${fnName}(${sig}):`);
  // first yield: capture answer only if the grader uses it
  if (grader.usesAnswer) {
    lines.push(`${INDENT}prompt = ${promptExpr}`);
    lines.push(`${INDENT}answer = yield prompt`);
  } else {
    lines.push(`${INDENT}prompt = ${promptExpr}`);
    lines.push(`${INDENT}yield prompt`);
  }
  for (const l of grader.lines) lines.push(l);

  return {
    fn: fnName,
    source: lines.join("\n"),
    graderSymbols: grader.graderSymbols,
    diagnostics,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Taskset expansion (one template → many concrete tasks)
// ─────────────────────────────────────────────────────────────────────────

function cartesian(params: TaskParam[]): Array<Record<string, ParamValue>> {
  const varying = params.filter((p) => p.values && p.values.length > 0);
  if (varying.length === 0) return [{}];
  let combos: Array<Record<string, ParamValue>> = [{}];
  for (const p of varying) {
    const next: Array<Record<string, ParamValue>> = [];
    for (const base of combos) {
      for (const v of p.values!) next.push({ ...base, [p.name]: v });
    }
    combos = next;
  }
  return combos;
}

function taskCalls(task: TaskBlock, fnName: string): string[] {
  const params = task.params ?? [];
  const combos = cartesian(params);
  return combos.map((combo) => {
    const args = Object.entries(combo)
      .map(([k, v]) => `${pyName(k, k)}=${pyLiteral(v)}`)
      .join(", ");
    return `${fnName}(${args})`;
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────────────────────────────────────

export function synthesizeTasks(env: EnvJSON, options: SynthOptions = {}): TaskSynthResult {
  const envVar = options.envVar ?? "env";
  const collect = options.collect ?? "taskset";
  const tasks = (env.children ?? []).filter((c): c is TaskBlock => c.type === "task");

  const diagnostics: Diagnostic[] = [];
  const functions: string[] = [];
  const graderSymbols = new Set<string>();
  const usedNames = new Map<string, number>();
  const callExprs: string[] = [];

  if (tasks.length === 0) {
    diagnostics.push({
      level: "warn",
      code: "env.no_tasks",
      message: "No task blocks found; the environment has nothing to grade.",
    });
  }

  tasks.forEach((task, i) => {
    // unique python function name
    let base = pyName(task.name, `task_${i + 1}`);
    if (usedNames.has(base)) {
      const n = usedNames.get(base)! + 1;
      usedNames.set(base, n);
      diagnostics.push({
        level: "warn",
        code: "task.duplicate_name",
        taskId: task.id,
        message: `Duplicate task name "${base}"; renamed to "${base}_${n}".`,
      });
      base = `${base}_${n}`;
    } else {
      usedNames.set(base, 1);
    }

    const emitted = emitTask(task, i, base);
    emitted.graderSymbols.forEach((s) => graderSymbols.add(s));
    diagnostics.push(...emitted.diagnostics);
    functions.push(`@${envVar}.template()\n${emitted.source}`);
    callExprs.push(...taskCalls(task, base));
  });

  // imports: graders (one combined line) + Taskset
  const imports: string[] = [];
  if (graderSymbols.size > 0) {
    imports.push(`from hud.graders import ${[...graderSymbols].sort().join(", ")}`);
  }
  if (collect === "taskset" && callExprs.length > 0) {
    imports.push("from hud import Taskset");
  }

  // collection
  const tsName = options.tasksetName ?? env.taskset ?? env.name ?? "tasks";
  let taskset: string;
  if (callExprs.length === 0) {
    taskset = "tasks = []";
  } else if (collect === "list") {
    taskset = `tasks = [\n${callExprs.map((c) => `${INDENT}${c},`).join("\n")}\n]`;
  } else {
    taskset = `tasks = Taskset(${pyStr(tsName)}, [\n${callExprs
      .map((c) => `${INDENT}${c},`)
      .join("\n")}\n])`;
  }

  // golden-gate hint: a single concrete task gives no taskset diversity
  if (callExprs.length === 1) {
    diagnostics.push({
      level: "info",
      code: "taskset.single",
      message:
        "Only one concrete task. Add parameters with `values` (seeds/difficulties) to build a diverse " +
        "taskset — RL needs spread to learn (HUD: Designing tasks).",
    });
  }

  return { imports, functions, taskset, taskCount: callExprs.length, diagnostics };
}

/** Convenience: just the python source for the task half (functions + taskset). */
export function renderTaskSource(env: EnvJSON, options: SynthOptions = {}): string {
  const r = synthesizeTasks(env, options);
  return [...r.functions, "", r.taskset].join("\n\n").replace(/\n{3,}/g, "\n\n") + "\n";
}
