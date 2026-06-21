# bench-ception v3 — DELIVERABLES (must ALL be ✅ by morning)

REAL training + REAL leaderboard on the HUD platform. No stubs, no fake rewards,
no skipped steps, no "smoke shows". Every checkbox has a deterministic,
verifiable acceptance test.

## Fixed entities (do not change)
| Role | Exact id |
|---|---|
| Golden / held-out benchmark | platform taskset **`sc-bench`** (real SC-bench, deployed) |
| Trainee base | **`Qwen/Qwen3-8B`** |
| Fork A | **`trained-on-gpt-5-5-supchain-env`** — trained on the **GPT-5.5** builder env |
| Fork B | **`trained-on-opus-4-8-env`** — trained on the **Opus 4.8** builder env |
| Baseline | untrained **`Qwen/Qwen3-8B`** |
| Builder envs | `.generated/v3_plans/gpt-5.5.env.py`, `.generated/v3_plans/claude-opus-4-8.env.py` (18 tasks each) |
| Eval setting | **group = 5** (5 traces per task) on `sc-bench` |

## Deliverables + acceptance tests

- [ ] **D1. Fork A really trained.** ≥1 real `trainer.step` gradient update on the
  GPT-5.5 env, on rollouts with non-degenerate reward spread.
  - ACCEPT: `hud models checkpoints trained-on-gpt-5-5-supchain-env` shows **>1**
    checkpoint node, latest with a `mean_reward`. `training_status.json` →
    `gpt-5.5.done_steps >= 1` with `ckpt_mean_reward` set.
- [ ] **D2. Fork B really trained.** Same on the Opus env.
  - ACCEPT: `hud models checkpoints trained-on-opus-4-8-env` shows **>1** node;
    `claude-opus-4-8.done_steps >= 1`.
- [ ] **D3. All three models evaluated on the golden, group=5.** Fork A, Fork B,
  untrained `Qwen/Qwen3-8B` each run on `sc-bench` with `--group-size 5 --full`.
  - ACCEPT: 3 platform Jobs exist on taskset `sc-bench`, each with 25 tasks × 5
    traces, real mean reward. Job URLs recorded below.
- [ ] **D4. HUD leaderboard shows all three.** best@1 / best@3 + mean per model on
  the `sc-bench` taskset leaderboard.
  - ACCEPT: leaderboard URL recorded; the 3 models appear with their scores.
- [ ] **D5. Gemma repeat.** Same as D1–D4 with a Gemma trainee.
  - NOTE: `gemma-4-*` is `is_trainable: false` on HUD. If no trainable Gemma
    exists, this is BLOCKED-BY-PLATFORM and must be documented with the exact
    `hud models` evidence + the closest trainable alternative attempted.

## Exact commands
```bash
HUDPY=~/.local/share/uv/tools/hud-python/bin/python
# Train both forks (real, client-here recipe; caffeinated, nohup):
PYTHONPATH=. $HUDPY -m environmentadi.train2 --steps-cap 3 --tasks-per-step 4 --group-cap 4
# Verify training advanced the checkpoint tree:
hud models checkpoints trained-on-gpt-5-5-supchain-env
hud models checkpoints trained-on-opus-4-8-env
# Leaderboard: eval all three on the golden, 5 traces/task -> platform Jobs:
hud eval sc-bench trained-on-gpt-5-5-supchain-env --remote --full --group-size 5 --yes
hud eval sc-bench trained-on-opus-4-8-env        --remote --full --group-size 5 --yes
hud eval sc-bench Qwen/Qwen3-8B                  --remote --full --group-size 5 --yes
```

## Results (fill in as they complete — REAL numbers only)
| Model | trained? | golden mean (g5) | best@1 | best@3 | job URL |
|---|---|---|---|---|---|
| trained-on-gpt-5-5-supchain-env | — | — | — | — | — |
| trained-on-opus-4-8-env | — | — | — | — | — |
| Qwen/Qwen3-8B (baseline) | n/a | ~0.42 (g5 prior) | — | — | — |

- Golden taskset: https://hud.ai/tasksets/d2db29a9-53b1-4a86-b8ae-6c164b26be8d
- Fork A model: https://hud.ai/models/d389dbff-5db7-4238-9143-59effb11028a
- Fork B model: https://hud.ai/models/647eba3f-e7c4-40f4-abd5-0a4148f2975a
- Leaderboard URL: _(to fill)_

## Hard rules
1. Training must be REAL gradient steps on REAL rollouts with reward spread (GRPO
   needs within-group spread). No constant/echo graders, no fabricated rewards.
2. Evals must be on the REAL golden `sc-bench`, group=5, on the platform.
3. If a path fails, try another (local/hosted runtime, retries) — do NOT fake it.
4. Not done until D1–D4 (and D5 or its documented platform block) are ✅.
