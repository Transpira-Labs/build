#!/bin/bash
cd /Users/adikrish/Desktop/claudeCode/hackathonBuild/build/EnvironmentAdi
export PATH="$HOME/.local/bin:$PATH"
HUDPY="$HOME/.local/share/uv/tools/hud-python/bin/python"
LOG=.generated/real.log
exec >> "$LOG" 2>&1
echo "================ REAL 10-STEP TRAINING $(date) ================"
echo "--- realtrainedongpt-5-5 (GPT-5.5 env) ---"
PYTHONPATH=. "$HUDPY" -m environmentadi.train3 --builder gpt-5.5 --steps 10 --val-group 5 --val-tasks 10
echo "--- realtrainedonclaudeopus4-8 (Opus env) ---"
PYTHONPATH=. "$HUDPY" -m environmentadi.train3 --builder claude-opus-4-8 --steps 10 --val-group 5 --val-tasks 10
echo "================ FINAL LEADERBOARD EVALS (full sc-bench, group 5) $(date) ================"
for M in realtrainedongpt-5-5 realtrainedonclaudeopus4-8 "Qwen/Qwen3-8B"; do
  echo "-------- eval $M --------"
  hud eval sc-bench "$M" --remote --full --group-size 5 --yes
done
echo "================ REAL COMPLETE $(date) ================"
touch .generated/REAL_DONE
