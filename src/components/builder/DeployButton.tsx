"use client";

// "Build it" — compile the project and deploy it to HUD via the local Python
// backend (POST /api/deploy). Runs the completeness check first, shows a live
// modal during the (slow) Docker build, and on success stores the deployed env
// name on the project so the run page knows what to query.

import { useState } from "react";
import Link from "next/link";
import {
  CircleAlert,
  CircleCheck,
  Hammer,
  Loader2,
  Play,
  TriangleAlert,
  X,
} from "lucide-react";
import { useProject } from "@/state/project";
import { toIR } from "@/lib/ir/schema";
import { toV1Blocks } from "@/lib/ir/v1";
import { checkEnvironment } from "@/lib/check";
import { runJob } from "@/lib/pollJob";

type Diag = { level: string; code: string; message: string };
type ToolStatus = { name: string; implemented: boolean };
type DeployResponse = {
  env_name?: string;
  version?: string;
  compiled?: boolean;
  deployable?: boolean;
  deployed?: boolean;
  message?: string;
  tools?: ToolStatus[];
  stubbed?: string[];
  diagnostics?: Diag[];
  logTail?: string;
  error?: string;
};

type Phase = "idle" | "blocked" | "deploying" | "done" | "error";

export function DeployButton() {
  const { doc, dispatch } = useProject();
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<DeployResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function build() {
    const ir = toIR(doc);
    const check = checkEnvironment(ir);
    if (!check.ready) {
      setError(
        `${check.errors} thing${check.errors === 1 ? "" : "s"} to fix first — open “Check it” to see them.`,
      );
      setPhase("blocked");
      return;
    }

    setPhase("deploying");
    setError(null);
    setResult(null);
    try {
      const data = await runJob<DeployResponse>("/api/deploy", { blocks: toV1Blocks(ir) });
      setResult(data);
      if (data.deployed) {
        const envUrl = (data.logTail || "").match(
          /https:\/\/hud\.ai\/environments\/[0-9a-f-]+/i,
        )?.[0];
        dispatch({
          type: "setDeploy",
          deploy: {
            envName: data.env_name || "environment",
            envUrl,
            version: data.version,
            status: "deployed",
            deployedAt: new Date().toISOString(),
            message: data.message,
          },
        });
        setPhase("done");
      } else {
        setError(data.message || "Compiled, but not deployed.");
        setPhase("error");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error.");
      setPhase("error");
    }
  }

  const close = () => {
    if (phase !== "deploying") setPhase("idle");
  };

  return (
    <>
      <button
        onClick={build}
        disabled={phase === "deploying"}
        className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground hover:opacity-90 disabled:opacity-60"
      >
        {phase === "deploying" ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Hammer className="size-3.5" />
        )}
        {phase === "deploying" ? "Building…" : "Build it"}
      </button>

      {phase !== "idle" && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <Hammer className="size-4 text-accent" />
              <p className="text-sm font-semibold">Build &amp; deploy to HUD</p>
              {phase !== "deploying" && (
                <button
                  onClick={close}
                  className="ml-auto rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label="Close"
                >
                  <X className="size-4" />
                </button>
              )}
            </div>

            <div className="px-4 py-4">
              {phase === "blocked" && (
                <div className="flex gap-2.5">
                  <CircleAlert className="mt-0.5 size-4 shrink-0 text-red-500" />
                  <p className="text-sm text-foreground">{error}</p>
                </div>
              )}

              {phase === "deploying" && (
                <div className="flex flex-col items-center gap-3 py-4 text-center">
                  <Loader2 className="size-7 animate-spin text-accent" />
                  <div>
                    <p className="text-sm font-medium">Compiling and deploying…</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Synthesizing tools &amp; tasks, then building the HUD image. This
                      can take a few minutes — keep this tab open.
                    </p>
                  </div>
                </div>
              )}

              {phase === "done" && result && (
                <div className="space-y-3">
                  <div className="flex gap-2.5">
                    <CircleCheck className="mt-0.5 size-4 shrink-0 text-green-600" />
                    <div>
                      <p className="text-sm font-semibold">Deployed to HUD</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Environment{" "}
                        <span className="font-mono text-foreground">
                          {result.env_name}
                        </span>
                        {result.version && (
                          <span className="text-muted-foreground"> · v{result.version}</span>
                        )}
                      </p>
                    </div>
                  </div>

                  {result.stubbed && result.stubbed.length > 0 && (
                    <div className="flex gap-2.5 rounded-lg border border-amber-300 bg-amber-50 p-2.5">
                      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-500" />
                      <div className="text-xs">
                        <p className="font-semibold text-amber-800">
                          {result.stubbed.length} tool
                          {result.stubbed.length === 1 ? "" : "s"} couldn&apos;t be
                          implemented
                        </p>
                        <p className="mt-0.5 leading-relaxed text-amber-700">
                          They&apos;ll just echo their input (no real data):{" "}
                          <span className="font-mono">{result.stubbed.join(", ")}</span>. The
                          code-generation step didn&apos;t run — hit{" "}
                          <span className="font-semibold">Build it</span> again to retry.
                        </p>
                      </div>
                    </div>
                  )}

                  {result.tools && result.tools.length > 0 && (
                    <ul className="space-y-1 rounded-lg border border-border bg-muted/40 p-2">
                      {result.tools.map((t) => (
                        <li key={t.name} className="flex items-center gap-2 px-1 text-xs">
                          {t.implemented ? (
                            <CircleCheck className="size-3.5 shrink-0 text-green-600" />
                          ) : (
                            <TriangleAlert className="size-3.5 shrink-0 text-amber-500" />
                          )}
                          <span className="font-mono text-foreground/80">{t.name}</span>
                          <span className="ml-auto text-muted-foreground">
                            {t.implemented ? "implemented" : "stub"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}

                  <Diagnostics diagnostics={result.diagnostics} />
                  <Link
                    href={`/build/${doc.id}/runs`}
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-accent-foreground hover:opacity-90"
                  >
                    <Play className="size-3.5" /> Run examples on it
                  </Link>
                </div>
              )}

              {phase === "error" && (
                <div className="space-y-3">
                  <div className="flex gap-2.5">
                    <CircleAlert className="mt-0.5 size-4 shrink-0 text-red-500" />
                    <p className="text-sm text-foreground">{error}</p>
                  </div>
                  <Diagnostics diagnostics={result?.diagnostics} />
                  {result?.logTail && (
                    <details className="rounded-lg border border-border bg-muted/40">
                      <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-muted-foreground">
                        Build log
                      </summary>
                      <pre className="max-h-60 overflow-auto px-3 pb-3 font-mono text-[10px] leading-relaxed text-foreground/70">
                        {result.logTail}
                      </pre>
                    </details>
                  )}
                  <button
                    onClick={build}
                    className="w-full rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-muted"
                  >
                    Try again
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Diagnostics({ diagnostics }: { diagnostics?: Diag[] }) {
  if (!diagnostics || diagnostics.length === 0) return null;
  return (
    <ul className="space-y-1 rounded-lg border border-border bg-muted/40 p-2">
      {diagnostics.map((d, i) => (
        <li key={i} className="flex gap-2 px-1 text-xs">
          {d.level === "error" ? (
            <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-red-500" />
          ) : (
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
          )}
          <span className="text-muted-foreground">
            <span className="font-mono text-foreground/80">{d.code}</span> — {d.message}
          </span>
        </li>
      ))}
    </ul>
  );
}
