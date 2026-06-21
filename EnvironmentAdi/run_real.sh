#!/bin/bash
cd /Users/adikrish/Desktop/claudeCode/hackathonBuild/build/EnvironmentAdi
export PATH="$HOME/.local/bin:$PATH"
HUDPY="$HOME/.local/share/uv/tools/hud-python/bin/python"
LOG=.generated/real.log
exec >> "$LOG" 2>&1
echo "================ REAL 10-STEP TRAINING (sequential) $(date) ================"
echo "--- fork: realtrainedongpt-5-5 (GPT-5.5 env) ---"
PYTHONPATH=. "$HUDPY" -m environmentadi.train3 --builder gpt-5.5 --steps 10 --val-group 5
echo "--- fork: realtrainedonclaudeopus4-8 (Opus env) ---"
PYTHONPATH=. "$HUDPY" -m environmentadi.train3 --builder claude-opus-4-8 --steps 10 --val-group 5
echo "================ REAL TRAINING COMPLETE $(date) ================"
touch .generated/REAL_DONE
