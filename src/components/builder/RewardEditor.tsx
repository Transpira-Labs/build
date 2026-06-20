"use client";

// The Reward sub-block editor. Guided "fill-in-the-blank" mode compiles to a
// deterministic verifier; advanced free-text is opt-in.

import { useProject } from "@/state/project";
import type { RewardComparator, RewardValue } from "@/lib/blocks/model";

const COMPARATORS: { value: RewardComparator; label: string }[] = [
  { value: "equals", label: "is exactly" },
  { value: "contains", label: "contains" },
  { value: "is_at_least", label: "is at least" },
  { value: "is_at_most", label: "is at most" },
];

const field =
  "rounded-md border border-input bg-card px-2 py-1 outline-none focus:border-accent focus:ring-2 focus:ring-ring";

export function RewardEditor({
  containerId,
  subId,
  reward,
}: {
  containerId: string;
  subId: string;
  reward: RewardValue;
}) {
  const { dispatch } = useProject();
  const patch = (p: Partial<RewardValue>) =>
    dispatch({ type: "patchReward", containerId, subId, patch: p });

  if (reward.mode === "advanced") {
    return (
      <div className="space-y-2">
        <textarea
          value={reward.freeText}
          onChange={(e) => patch({ freeText: e.target.value })}
          placeholder="Describe exactly how to score the answer. Be specific about what earns the point."
          rows={3}
          className={`w-full resize-none text-sm ${field}`}
        />
        <button
          onClick={() => patch({ mode: "guided" })}
          className="text-xs font-semibold text-accent hover:underline"
        >
          ← Back to easy mode
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <span>Give</span>
        <input
          type="number"
          min={0}
          max={1}
          step={0.5}
          value={reward.points}
          onChange={(e) => patch({ points: Number(e.target.value) })}
          className={`w-14 text-center ${field}`}
          aria-label="points"
        />
        <span>point if the answer</span>
        <select
          value={reward.comparator}
          onChange={(e) =>
            patch({ comparator: e.target.value as RewardComparator })
          }
          className={field}
          aria-label="how to compare"
        >
          {COMPARATORS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={reward.target}
          onChange={(e) => patch({ target: e.target.value })}
          placeholder="3"
          className={`w-24 ${field}`}
          aria-label="the right answer"
        />
      </div>
      <button
        onClick={() => patch({ mode: "advanced" })}
        className="text-xs font-semibold text-accent hover:underline"
      >
        Need something trickier? Switch to free writing →
      </button>
    </div>
  );
}
