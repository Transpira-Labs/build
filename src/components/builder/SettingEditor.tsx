"use client";

// The Practice "Setting" sub-block editor. Minimal options, sensible defaults,
// plain language.

import { useProject } from "@/state/project";
import type { SettingValue } from "@/lib/blocks/model";

const MODELS = [
  { value: "qwen3-8b", label: "Small & fast" },
  { value: "qwen3-14b", label: "Medium" },
  { value: "qwen3-32b", label: "Big & careful" },
];

const field =
  "rounded-md border border-input bg-card px-2 py-1 outline-none focus:border-accent focus:ring-2 focus:ring-ring";

export function SettingEditor({
  containerId,
  subId,
  setting,
}: {
  containerId: string;
  subId: string;
  setting: SettingValue;
}) {
  const { dispatch } = useProject();
  const patch = (p: Partial<SettingValue>) =>
    dispatch({ type: "patchSetting", containerId, subId, patch: p });

  return (
    <div className="space-y-3 text-sm">
      <label className="block">
        <span className="font-semibold">Practice rounds: {setting.episodes}</span>
        <input
          type="range"
          min={10}
          max={1000}
          step={10}
          value={setting.episodes}
          onChange={(e) => patch({ episodes: Number(e.target.value) })}
          className="mt-1 w-full accent-accent"
        />
      </label>

      <label className="block">
        <span className="font-semibold">How clever a helper?</span>
        <select
          value={setting.baseModel}
          onChange={(e) => patch({ baseModel: e.target.value })}
          className={`mt-1 w-full ${field}`}
        >
          {MODELS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="font-semibold">What to learn from</span>
        <input
          type="text"
          value={setting.learnFrom}
          onChange={(e) => patch({ learnFrom: e.target.value })}
          className={`mt-1 w-full ${field}`}
        />
      </label>
    </div>
  );
}
