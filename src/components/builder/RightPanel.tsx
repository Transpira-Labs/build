"use client";

// The right config panel (itch-style): a Training section on top, then the live
// environment Output (the IR as JSON). Warm-alpine palette, not itch's blues.

import { useRef, useState } from "react";
import { Check, Copy, Upload } from "lucide-react";
import { BLOCKS } from "@/lib/blocks/model";
import { coerceDoc } from "@/lib/blocks/coerce";
import { fromIR, irSchema, toIR } from "@/lib/ir/schema";
import { useProject } from "@/state/project";

export function RightPanel() {
  const { doc, dispatch } = useProject();
  const [copied, setCopied] = useState(false);

  // Import: replace the whole environment with an uploaded ProjectDoc JSON file.
  const fileRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const train = doc.train;
  const modelOptions = BLOCKS.model.options ?? [];
  const sizeDef = BLOCKS.set_size.number!;
  const steps = train.setSize;

  const json = JSON.stringify(toIR(doc), null, 2);

  const copy = () => {
    navigator.clipboard?.writeText(json);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // reset so the same file can be re-selected later
    if (!file) return;
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const rec =
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : null;

      // Accept either an exported IR (what the Output pane shows) or the raw
      // ProjectDoc (has a `blocks` array). Detect by shape.
      let nextDoc;
      if (rec && Array.isArray(rec.blocks)) {
        nextDoc = coerceDoc(parsed, doc);
      } else {
        const res = irSchema.safeParse(parsed);
        if (!res.success) {
          throw new Error("Unrecognized JSON — expected an exported environment");
        }
        nextDoc = fromIR(res.data);
      }

      dispatch({ type: "load", doc: nextDoc });
      setImportError(null);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Could not import file");
    }
  };

  return (
    <aside className="flex w-72 shrink-0 flex-col border-l border-border bg-card">
      {/* Training */}
      <div className="border-b border-border p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Training
        </p>

        <div className="mt-3 space-y-3.5">
          <div>
            <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">
              Model
            </p>
            <div className="flex gap-1.5">
              {modelOptions.map((o) => {
                const active = (train.model || modelOptions[0]?.value) === o.value;
                return (
                  <button
                    key={o.value}
                    onClick={() => dispatch({ type: "setTrain", patch: { model: o.value } })}
                    className={`flex-1 rounded-lg border px-2 py-2 text-[11px] font-semibold transition-colors ${
                      active
                        ? "border-accent bg-accent text-accent-foreground"
                        : "border-border text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {o.label.split(/[ &]/)[0]}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between text-[11px]">
              <span className="font-medium text-muted-foreground">
                Practice rounds
              </span>
              <span className="font-semibold text-foreground">{steps}</span>
            </div>
            <input
              type="range"
              min={sizeDef.min}
              max={sizeDef.max}
              step={sizeDef.step}
              value={steps}
              onChange={(e) =>
                dispatch({ type: "setTrain", patch: { setSize: Number(e.target.value) } })
              }
              className="w-full accent-accent"
            />
          </div>
        </div>
      </div>

      {/* Output — read-only IR, with Import to replace the doc from a JSON file. */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-border px-4 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Output
          </p>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            onChange={onImportFile}
            className="hidden"
          />
          <button
            onClick={() => fileRef.current?.click()}
            title="Replace this environment with an uploaded JSON file"
            className="ml-auto flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
          >
            <Upload className="size-3.5" />
            Import
          </button>
          <button
            onClick={copy}
            className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>

        {importError && (
          <div className="border-b border-border bg-red-50 px-4 py-2 text-[11px] leading-relaxed text-red-600">
            ⚠ {importError} — nothing imported
          </div>
        )}

        <pre className="min-h-0 flex-1 overflow-auto p-4 font-mono text-[11px] leading-relaxed text-foreground/75">
          {json}
        </pre>
      </div>
    </aside>
  );
}
