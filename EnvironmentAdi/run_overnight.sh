#!/bin/bash
cd /Users/adikrish/Desktop/claudeCode/hackathonBuild/build/EnvironmentAdi
export PATH="$HOME/.local/bin:$PATH"
HUDPY="$HOME/.local/share/uv/tools/hud-python/bin/python"
LOG=.generated/overnight.log
echo "===== TRAINING START $(date) =====" >> "$LOG"
PYTHONPATH=. "$HUDPY" -m environmentadi.train2 --steps-cap 3 --tasks-per-step 4 --group-cap 4 --max-concurrent 2 >> "$LOG" 2>&1
echo "===== TRAINING DONE $(date) =====" >> "$LOG"
hud models checkpoints trained-on-gpt-5-5-supchain-env >> "$LOG" 2>&1
hud models checkpoints trained-on-opus-4-8-env >> "$LOG" 2>&1
echo "===== LEADERBOARD EVALS group=5 $(date) =====" >> "$LOG"
for M in trained-on-gpt-5-5-supchain-env trained-on-opus-4-8-env "Qwen/Qwen3-8B"; do
  echo "----- eval $M -----" >> "$LOG"
  hud eval sc-bench "$M" --remote --full --group-size 5 --yes >> "$LOG" 2>&1
done
echo "===== OVERNIGHT COMPLETE $(date) =====" >> "$LOG"
touch .generated/OVERNIGHT_DONE
