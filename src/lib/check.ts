// Preliminary compiler check: a deterministic, read-only pass over the IR that
// verifies the environment has everything HUD needs to become a real RL
// environment. It never generates code or deploys — it just reports what's
// missing or risky, split into "must fix" (errors) and "suggestions" (warnings).

import type { IR } from "./ir/schema";

export type CheckLevel = "error" | "warning";

export interface CheckIssue {
  level: CheckLevel;
  /** Friendly, plain-language message. */
  message: string;
  /** Where it applies — a block/section name to orient the user. */
  where: string;
}

export interface CheckResult {
  /** No errors — safe to attempt a build. */
  ready: boolean;
  issues: CheckIssue[];
  errors: number;
  warnings: number;
}

export function checkEnvironment(ir: IR): CheckResult {
  const issues: CheckIssue[] = [];
  const err = (where: string, message: string) =>
    issues.push({ level: "error", where, message });
  const warn = (where: string, message: string) =>
    issues.push({ level: "warning", where, message });

  // --- Environment -------------------------------------------------------
  if (!ir.environment.description.trim()) {
    err(
      "Environment",
      "Add a description so HUD knows what this environment is for.",
    );
  }

  // --- Tasks (the training/eval signal) ----------------------------------
  if (ir.tasks.length === 0) {
    err("Tasks", "Add at least one Task — there's nothing to test or train on yet.");
  } else {
    ir.tasks.forEach((t, i) => {
      const name = t.name?.trim() || `Task ${i + 1}`;
      if (!t.prompt.trim()) {
        err(name, "This task has no question to ask the agent.");
      }
      if (t.rubric.good.length === 0) {
        err(
          name,
          "No Good answer defined — without one the agent can never earn reward, so it can't be trained.",
        );
      }
      if (t.rubric.good.length > 0 && t.rubric.bad.length === 0) {
        warn(
          name,
          "No Bad answer — consider adding one so wrong answers clearly score nothing.",
        );
      }
      t.references.forEach((r) => {
        if (!r.value.trim()) {
          warn(name, "An attached reference is empty.");
        } else if (r.mode === "upload") {
          warn(
            name,
            `Uploaded file “${r.value}” isn't wired up yet — it'll be treated as a placeholder.`,
          );
        }
      });
    });
  }

  // --- Tools -------------------------------------------------------------
  if (ir.tools.length === 0) {
    warn(
      "Tools",
      "No tools yet — the agent can only answer in text. Add a Tool if it needs to take actions.",
    );
  } else {
    ir.tools.forEach((tool, i) => {
      const name = tool.name?.trim() || `Tool ${i + 1}`;
      if (!tool.description.trim()) {
        err(name, "This tool doesn't say what it does.");
      }
      if (!tool.returns.trim()) {
        warn(name, "This tool doesn't say what it returns — the agent may not know what to expect.");
      }
    });
  }

  // --- Training ----------------------------------------------------------
  if (!ir.train.base_model?.trim()) {
    warn("Training", "No model picked to train.");
  }
  if (!ir.train.set_size) {
    warn("Training", "Practice rounds is 0 — set how much the agent should train.");
  }

  const errors = issues.filter((i) => i.level === "error").length;
  const warnings = issues.filter((i) => i.level === "warning").length;
  return { ready: errors === 0, issues, errors, warnings };
}
