"use client";

// Bench-ception runner. Reads the environments you've built (localStorage, via
// the existing library hook), projects each to its IR with the existing toIR(),
// and — when YOU choose — POSTs them to /api/benchception/run, which kicks off
// the EnvironmentAdi harness. Polls /api/benchception/status for the result.
//
// Self-contained (inline styles); imports only existing read APIs, edits nothing.

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useEnvironments } from "@/lib/library";
import { toIR } from "@/lib/ir/schema";

type BuilderResult = { model: string; role: string; best: number | null; mean: number | null; valid: string };
type SpecResult = { name: string; file: string; builders: BuilderResult[] };
type Status = {
  state: "idle" | "waiting" | "running" | "done" | "error";
  count?: number; threshold?: number; message?: string; error?: string;
  results?: { meta?: Record<string, unknown>; specs?: SpecResult[] };
};

const C = {
  cream: "#FBF5EC", paper: "#FFFDF8", ink: "#33271F", ink2: "#6A5746",
  line: "#E6D8C5", burnt: "#C2611F", burnt2: "#A44E14", teal: "#5E7C6E", gold: "#D9A441",
};

export default function BenchceptionPage() {
  const { envs, ready } = useEnvironments();
  const [threshold, setThreshold] = useState(3);
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const [launching, setLaunching] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Project each built environment to its IR (skip any that fail to project).
  const specs = envs
    .map((e) => {
      try {
        return { id: e.doc.id, name: e.doc.name, ir: toIR(e.doc) };
      } catch {
        return null;
      }
    })
    .filter(Boolean) as { id: string; name: string; ir: ReturnType<typeof toIR> }[];

  const enough = specs.length >= threshold;
  const active = status.state === "running" || status.state === "waiting";

  const poll = useCallback(async () => {
    const r = await fetch("/api/benchception/status", { cache: "no-store" });
    const s: Status = await r.json();
    setStatus(s);
    if (s.state === "done" || s.state === "error") {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
      setLaunching(false);
    }
  }, []);

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  async function launch() {
    setLaunching(true);
    setStatus({ state: "running", count: specs.length, threshold });
    await fetch("/api/benchception/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ specs: specs.map((s) => s.ir), threshold, buildAttempts: 3, group: 1 }),
    });
    if (timer.current) clearInterval(timer.current);
    timer.current = setInterval(poll, 3000);
    poll();
  }

  return (
    <main style={{ minHeight: "100vh", background: C.cream, color: C.ink,
      fontFamily: "'Source Serif 4', Georgia, serif", padding: "0 0 60px" }}>
      <div style={{ maxWidth: 980, margin: "0 auto", padding: "0 28px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "26px 0 8px" }}>
          <Link href="/" style={{ color: C.burnt2, fontFamily: "Montserrat, sans-serif",
            fontWeight: 700, fontSize: 13, textDecoration: "none" }}>← environments</Link>
        </div>
        <h1 style={{ fontFamily: "Montserrat, sans-serif", fontWeight: 800, fontSize: 40,
          letterSpacing: "-0.02em", margin: "6px 0 4px" }}>
          Bench&#8209;ception<span style={{ color: C.burnt }}>.</span>
        </h1>
        <p style={{ fontSize: 19, color: C.ink2, maxWidth: "64ch", marginTop: 0 }}>
          A benchmark over the environments you&apos;ve built. Each becomes a spec that competing
          models must rebuild as a HUD environment; a probe agent then scores how well each was built.
        </p>

        {/* readiness + launch */}
        <section style={{ background: C.paper, border: `1px solid ${C.line}`, borderRadius: 16,
          padding: 22, marginTop: 18, boxShadow: "0 6px 22px rgba(51,39,31,.07)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 22, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontFamily: "Montserrat, sans-serif", fontWeight: 800, fontSize: 34 }}>
                {ready ? specs.length : "…"}<span style={{ color: C.ink2, fontWeight: 600, fontSize: 20 }}> / {threshold}</span>
              </div>
              <div style={{ fontFamily: "Montserrat, sans-serif", fontWeight: 700, fontSize: 11,
                letterSpacing: ".08em", textTransform: "uppercase", color: C.ink2 }}>
                environments ready
              </div>
            </div>
            <label style={{ fontFamily: "Montserrat, sans-serif", fontWeight: 600, fontSize: 13, color: C.ink2 }}>
              threshold&nbsp;
              <input type="number" min={1} value={threshold}
                onChange={(e) => setThreshold(Math.max(1, Number(e.target.value) || 1))}
                style={{ width: 64, padding: "6px 8px", borderRadius: 8, border: `1px solid ${C.line}`,
                  fontFamily: "'JetBrains Mono', monospace", fontSize: 14 }} />
            </label>
            <button onClick={launch} disabled={!enough || launching || active}
              style={{ marginLeft: "auto", fontFamily: "Montserrat, sans-serif", fontWeight: 800,
                fontSize: 15, color: "#fff", background: enough && !active ? C.burnt : "#c9b8a6",
                border: "none", borderRadius: 11, padding: "13px 22px",
                cursor: enough && !active ? "pointer" : "not-allowed" }}>
              {active ? "Running…" : "▶ Run bench-ception"}
            </button>
          </div>
          {!enough && ready && (
            <p style={{ color: C.ink2, fontStyle: "italic", margin: "12px 0 0", fontSize: 14 }}>
              Build {threshold - specs.length} more environment(s), or lower the threshold, to launch.
            </p>
          )}
          {status.message && status.state === "waiting" && (
            <p style={{ color: C.burnt2, margin: "12px 0 0", fontSize: 14 }}>{status.message}</p>
          )}
          {status.state === "running" && (
            <p style={{ color: C.burnt2, margin: "12px 0 0", fontSize: 14 }}>
              Running over {status.count ?? specs.length} environment(s) — builders writing envs + probe evaluating. This can take a few minutes.
            </p>
          )}
          {status.state === "error" && (
            <p style={{ color: "#b23b2e", margin: "12px 0 0", fontSize: 14 }}>Error: {status.error}</p>
          )}
        </section>

        {/* the queued environments */}
        <h2 style={sectionLbl}>Environments to be benchmarked</h2>
        {ready && specs.length === 0 && (
          <p style={{ color: C.ink2, fontStyle: "italic" }}>None yet — build some on the dashboard first.</p>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 12 }}>
          {specs.map((s) => (
            <div key={s.id} style={{ background: C.paper, border: `1px solid ${C.line}`,
              borderRadius: 12, padding: "12px 14px" }}>
              <div style={{ fontFamily: "Montserrat, sans-serif", fontWeight: 700 }}>{s.name}</div>
              <div style={{ fontSize: 12, color: C.ink2, fontFamily: "'JetBrains Mono', monospace" }}>
                {s.ir.tools.length} tool(s) · {s.ir.tasks.length} task(s)
              </div>
            </div>
          ))}
        </div>

        {/* results */}
        {status.state === "done" && status.results?.specs && (
          <>
            <h2 style={sectionLbl}>Results · probe scores (best / mean per builder)</h2>
            {status.results.specs.map((sp) => (
              <div key={sp.file} style={{ background: C.paper, border: `1px solid ${C.line}`,
                borderRadius: 12, padding: "14px 16px", marginBottom: 12 }}>
                <div style={{ fontFamily: "Montserrat, sans-serif", fontWeight: 800, fontSize: 16 }}>{sp.name}</div>
                <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
                  <tbody>
                    {[...sp.builders].sort((a, b) => (b.best ?? 0) - (a.best ?? 0)).map((b) => (
                      <tr key={b.model} style={{ borderTop: `1px solid ${C.line}` }}>
                        <td style={{ padding: "7px 4px", fontFamily: "'JetBrains Mono', monospace",
                          fontSize: 13, color: C.burnt2 }}>{b.model}
                          {b.role === "golden author" && <span style={{ color: C.gold, fontWeight: 700 }}> ★</span>}
                        </td>
                        <td style={{ padding: "7px 4px", fontFamily: "Montserrat, sans-serif", fontWeight: 800 }}>
                          {b.best == null ? "—" : b.best.toFixed(2)}
                        </td>
                        <td style={{ padding: "7px 4px", color: C.ink2, fontSize: 13 }}>
                          mean {b.mean == null ? "—" : b.mean.toFixed(2)} · {b.valid} valid
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
            <p style={{ color: C.ink2, fontSize: 14 }}>
              Full traces (system prompts, tool calls, every attempt) are in the trace dashboard:&nbsp;
              <code style={{ fontFamily: "'JetBrains Mono', monospace" }}>EnvironmentAdi/dashboard/index.html</code>
            </p>
          </>
        )}
      </div>
    </main>
  );
}

const sectionLbl: CSSProperties = {
  fontFamily: "Montserrat, sans-serif", fontWeight: 700, fontSize: 12,
  letterSpacing: ".09em", textTransform: "uppercase", color: "#6A5746", margin: "28px 0 10px",
};
