#!/bin/bash
cd /Users/adikrish/Desktop/claudeCode/hackathonBuild/build/EnvironmentAdi
export PATH="$HOME/.local/bin:$PATH"
HUDPY="$HOME/.local/share/uv/tools/hud-python/bin/python"
LOG=.generated/finish.log
exec >> "$LOG" 2>&1
echo "================ FINISH START $(date) ================"
T(){ PYTHONPATH=. "$HUDPY" -m environmentadi.train2 --solo "$1" --steps-cap "$2" --tasks-per-step 4 --group-cap 4 --max-concurrent 2; }

echo "--- continue-train Qwen gpt fork (+2) ---";  T gpt-5.5 2
echo "--- continue-train Qwen opus fork (+3, was incomplete) ---"; T claude-opus-4-8 3
echo "--- train Llama(gemma-equiv) gpt fork (3) ---"
TRAIN2_FORKS='{"gpt-5.5":"gemma-equiv-on-gpt-5-5-supchain-env"}' TRAIN2_STATUS=.generated/status_llama_gpt.json T gpt-5.5 3
echo "--- train Llama(gemma-equiv) opus fork (3) ---"
TRAIN2_FORKS='{"claude-opus-4-8":"gemma-equiv-on-opus-4-8-env"}' TRAIN2_STATUS=.generated/status_llama_opus.json T claude-opus-4-8 3

echo "================ LEADERBOARD EVALS group=5 $(date) ================"
for M in trained-on-gpt-5-5-supchain-env trained-on-opus-4-8-env "Qwen/Qwen3-8B" \
         gemma-equiv-on-gpt-5-5-supchain-env gemma-equiv-on-opus-4-8-env "meta-llama/Llama-3.2-3B" \
         gemma-4-31b-it; do
  echo "-------- eval $M --------"
  hud eval sc-bench "$M" --remote --full --group-size 5 --yes
done
echo "================ FINISH COMPLETE $(date) ================"
touch .generated/FINISH_DONE
