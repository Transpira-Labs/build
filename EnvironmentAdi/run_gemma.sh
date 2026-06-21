#!/bin/bash
cd /Users/adikrish/Desktop/claudeCode/hackathonBuild/build/EnvironmentAdi
export PATH="$HOME/.local/bin:$PATH"
HUDPY="$HOME/.local/share/uv/tools/hud-python/bin/python"
LOG=.generated/gemma.log
echo "===== GEMMA(Llama-3.2-3B) waiting for Qwen done $(date) =====" >> "$LOG"
while [ ! -f .generated/OVERNIGHT_DONE ]; do sleep 60; done
echo "===== GEMMA TRAINING START $(date) =====" >> "$LOG"
export TRAIN2_FORKS='{"gpt-5.5":"gemma-equiv-on-gpt-5-5-supchain-env","claude-opus-4-8":"gemma-equiv-on-opus-4-8-env"}'
export TRAIN2_STATUS=.generated/training_status_gemma.json
PYTHONPATH=. "$HUDPY" -m environmentadi.train2 --steps-cap 3 --tasks-per-step 4 --group-cap 4 --max-concurrent 2 >> "$LOG" 2>&1
echo "===== GEMMA TRAINING DONE $(date) =====" >> "$LOG"
hud models checkpoints gemma-equiv-on-gpt-5-5-supchain-env >> "$LOG" 2>&1
hud models checkpoints gemma-equiv-on-opus-4-8-env >> "$LOG" 2>&1
echo "===== GEMMA LEADERBOARD EVALS group=5 $(date) =====" >> "$LOG"
for M in gemma-equiv-on-gpt-5-5-supchain-env gemma-equiv-on-opus-4-8-env "meta-llama/Llama-3.2-3B"; do
  echo "----- eval $M -----" >> "$LOG"
  hud eval sc-bench "$M" --remote --full --group-size 5 --yes >> "$LOG" 2>&1
done
echo "===== GEMMA COMPLETE $(date) =====" >> "$LOG"
touch .generated/GEMMA_DONE
