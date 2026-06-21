// Self-test for the task synthesizer. Run: `node src/synth/tasks.test.ts`
// (Node 22 strips the TS types; no build step needed.)
import { synthesizeTasks, renderTaskSource, type EnvJSON } from "./tasks.ts";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
function section(t: string) {
  console.log(`\n${t}`);
}

// ── 1. Legacy UI JSON (today's actual export: {kind, criteria}) ────────────
section("1. legacy reward shapes normalize");
{
  const env: EnvJSON = {
    name: "my_rl_env",
    children: [
      { id: "x", type: "tool", kind: "browser", name: "browser" }, // opaque, ignored
      {
        id: "t1",
        type: "task",
        name: "Find Pricing",
        prompt: "Open the docs and find the price of Opus.",
        reward: { kind: "llm_judge", criteria: "States the correct Opus price" },
      },
      {
        id: "t2",
        type: "task",
        name: "echo answer",
        prompt: "Reply with the secret word.",
        reward: { kind: "exact_match", criteria: "swordfish" },
      },
    ],
  };
  const r = synthesizeTasks(env);
  check("two tasks emitted", r.functions.length === 2);
  check("tool block ignored", !r.functions.join("\n").includes("browser"));
  check("judge → LLMJudgeGrader import", r.imports.some((i) => i.includes("LLMJudgeGrader")));
  check("exact → exact_match import", r.imports.some((i) => i.includes("exact_match")));
  check("Taskset import present", r.imports.some((i) => i === "from hud import Taskset"));
  check("decorator uses env var", r.functions[0].startsWith("@env.template()"));
  check("function name sanitized", r.functions[0].includes("async def find_pricing("));
  check("judge passes question=prompt", r.functions[0].includes("question=prompt"));
  check("exact_match yields directly", r.functions[1].includes("yield exact_match(answer,"));
  check("taskset named after env", r.taskset.includes('Taskset("my_rl_env"'));
  check("surface-form warning on exact_match", r.diagnostics.some((d) => d.code === "grader.surface_form"));
}

// ── 2. Rich graders: bash (grade the world) + combine ──────────────────────
section("2. rich graders");
{
  const env: EnvJSON = {
    name: "coder",
    children: [
      {
        id: "b",
        type: "task",
        name: "add health endpoint",
        prompt: "Add a /health endpoint that returns 200.",
        reward: { kind: "bash", command: "pytest -q", cwd: "/workspace" },
      },
      {
        id: "c",
        type: "task",
        name: "implement feature",
        prompt: "Implement the spec and summarize what changed.",
        reward: {
          kind: "combine",
          parts: [
            { weight: 0.5, reward: { kind: "bash", command: "pytest -q" } },
            { weight: 0.5, reward: { kind: "llm_judge", criteria: "Matches the spec" } },
          ],
        },
      },
    ],
  };
  const r = synthesizeTasks(env);
  const bash = r.functions[0];
  check("bash uses BashGrader", bash.includes("await BashGrader.grade(command="));
  check("bash passes cwd", bash.includes('cwd="/workspace"'));
  check("bash does NOT capture answer", bash.includes("    yield prompt") && !bash.includes("answer = yield"));
  check("bash → no surface-form warning", !r.diagnostics.some((d) => d.code === "grader.surface_form"));
  const comb = r.functions[1];
  check("combine emits await combine(", comb.includes("yield await combine("));
  check("combine weights bash 0.5", comb.includes("BashGrader.grade(weight=0.5"));
  check("combine weights judge 0.5", comb.includes("LLMJudgeGrader.grade(weight=0.5"));
  check("combine captures answer", comb.includes("answer = yield"));
  check("combine import present", r.imports.some((i) => i.includes("combine")));
}

// ── 3. Parameters → template family (taskset expansion) ────────────────────
section("3. parameter expansion");
{
  const env: EnvJSON = {
    name: "letters",
    children: [
      {
        id: "p",
        type: "task",
        name: "count_letter",
        prompt: "How many '{letter}'s are in '{word}'?",
        params: [
          { name: "word", type: "str", values: ["strawberry", "raspberry", "blueberry"] },
          { name: "letter", type: "str", default: "r" },
        ],
        reward: { kind: "numeric_match", expected: 3 },
      },
    ],
  };
  const r = synthesizeTasks(env);
  check("signature has typed params", r.functions[0].includes('async def count_letter(word: str = "strawberry", letter: str = "r"):'));
  check("prompt is an f-string", r.functions[0].includes("prompt = f\""));
  check("expands to 3 concrete tasks", r.taskCount === 3, `got ${r.taskCount}`);
  check("taskset binds word arg", r.taskset.includes('count_letter(word="raspberry")'));
  check("numeric_match used", r.functions[0].includes("yield numeric_match(answer, 3)"));
}

// ── 4. Diagnostics / golden-gate hints ─────────────────────────────────────
section("4. diagnostics");
{
  const empty = synthesizeTasks({ name: "e", children: [] });
  check("no tasks → warning", empty.diagnostics.some((d) => d.code === "env.no_tasks"));

  const single = synthesizeTasks({
    name: "s",
    children: [{ id: "1", type: "task", name: "only", prompt: "do it", reward: { kind: "llm_judge", criteria: "done" } }],
  });
  check("single concrete task → spread hint", single.diagnostics.some((d) => d.code === "taskset.single"));

  const dup = synthesizeTasks({
    name: "d",
    children: [
      { id: "1", type: "task", name: "go", prompt: "a", reward: { kind: "custom", code: "" } },
      { id: "2", type: "task", name: "go", prompt: "b", reward: { kind: "custom", code: "" } },
    ],
  });
  check("duplicate names → renamed + warned", dup.diagnostics.some((d) => d.code === "task.duplicate_name") && dup.functions[1].includes("async def go_2("));

  const noCrit = synthesizeTasks({
    name: "n",
    children: [{ id: "1", type: "task", name: "x", prompt: "p", reward: { kind: "llm_judge", criteria: "" } }],
  });
  check("empty judge criteria → error", noCrit.diagnostics.some((d) => d.code === "judge.no_criteria"));
}

// ── 5. Full render smoke test ──────────────────────────────────────────────
section("5. rendered source");
{
  const env: EnvJSON = {
    name: "demo",
    children: [
      { id: "1", type: "task", name: "capital", prompt: "Capital of {country}?", params: [{ name: "country", values: ["France", "Japan"] }], reward: { kind: "exact_match", expected: "Paris" } },
    ],
  };
  const src = renderTaskSource(env);
  console.log("\n----- rendered task source -----");
  console.log(src);
  check("renders decorator + def + taskset", src.includes("@env.template()") && src.includes("async def capital(") && src.includes("Taskset("));
}

console.log(`\n${failures === 0 ? "✅ all checks passed" : `❌ ${failures} check(s) failed`}`);
process.exit(failures === 0 ? 0 : 1);
