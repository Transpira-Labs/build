"use client";

// The "Check it" control: runs the preliminary compiler check over the live IR
// and shows a friendly checklist of what still needs fixing before this can
// become a real RL environment. Read-only — it builds nothing.

import { useState } from "react";
import { CircleAlert, CircleCheck, TriangleAlert } from "lucide-react";
import { useProject } from "@/state/project";
import { toIR } from "@/lib/ir/schema";
import { checkEnvironment, type CheckIssue } from "@/lib/check";

export function CheckButton() {
  const { doc } = useProject();
  const [open, setOpen] = useState(false);
  const result = checkEnvironment(toIR(doc));

  const errors = result.issues.filter((i) => i.level === "error");
  const warnings = result.issues.filter((i) => i.level === "warning");

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
      >
        Check it
        {result.errors > 0 ? (
          <span className="inline-flex min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {result.errors}
          </span>
        ) : (
          <CircleCheck className="size-3.5 text-green-600" />
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-1.5 w-80 overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
            {/* Summary header */}
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              {result.ready ? (
                <CircleCheck className="size-4 shrink-0 text-green-600" />
              ) : (
                <CircleAlert className="size-4 shrink-0 text-red-500" />
              )}
              <p className="text-sm font-semibold">
                {result.ready
                  ? warnings.length === 0
                    ? "Ready to build"
                    : "Ready to build: a few ideas below"
                  : `${result.errors} thing${result.errors === 1 ? "" : "s"} to fix first`}
              </p>
            </div>

            <div className="max-h-[60vh] overflow-y-auto py-1">
              {errors.length > 0 && (
                <Section title="Fix before building" issues={errors} tone="error" />
              )}
              {warnings.length > 0 && (
                <Section title="Suggestions" issues={warnings} tone="warning" />
              )}
              {result.issues.length === 0 && (
                <p className="px-4 py-6 text-center text-xs text-muted-foreground">
                  Everything looks good. Nothing missing.
                </p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Section({
  title,
  issues,
  tone,
}: {
  title: string;
  issues: CheckIssue[];
  tone: "error" | "warning";
}) {
  const Icon = tone === "error" ? CircleAlert : TriangleAlert;
  const color = tone === "error" ? "text-red-500" : "text-amber-500";
  return (
    <div className="px-2 py-1.5">
      <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <ul>
        {issues.map((issue, i) => (
          <li key={i} className="flex gap-2 rounded-lg px-2 py-1.5 hover:bg-muted/50">
            <Icon className={`mt-0.5 size-3.5 shrink-0 ${color}`} />
            <span className="text-xs leading-relaxed">
              <span className="font-semibold text-foreground">{issue.where}</span>:{" "}
              <span className="text-muted-foreground">{issue.message}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
