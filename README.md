# ⚡ RL Scratch

A Scratch-style **visual block editor for reinforcement learning**, powered by [HUD](https://docs.hud.ai).
Instead of writing code, beginners drag blocks together to build an RL setup — and the app
generates runnable HUD (`env.py`) Python live.

## Block → HUD mapping

| Block            | HUD primitive       |
| ---------------- | ------------------- |
| Environment      | `Environment(...)`  |
| Tool (Browser)   | `Capability.cdp`    |
| Tool (Shell)     | `Capability.ssh`    |
| Tool (Custom)    | `Capability.mcp`    |
| Tool (Computer)  | `Capability.rfb`    |
| Task + Reward    | `@env.template()` task with a grader |
| Reward: LLM Judge / Exact Match / Custom | `LLMJudgeGrader` / comparison / custom |

## Run it

```bash
pnpm install
pnpm dev      # http://localhost:5173 (or next free port)
pnpm build    # typecheck + production build
```

## Layout

- `src/types.ts` — the block domain model + palette metadata
- `src/codegen.ts` — turns the canvas into HUD v6 Python
- `src/App.tsx` — palette, canvas, inspector, and live code preview

## Next steps

- Wire the **▶ Run** button to actually execute against HUD (run a `Taskset`, show the reward)
- Add an **Agent** block (model picker)
- Block reordering / snapping, save/load projects
