# Helper Lab

A Scratch-style, block-based builder for **HUD** reinforcement-learning
environments. Anyone — including kids and non-technical users — snaps together
visual blocks, describes each one in plain language, and gets an environment they
can build, test, and train on. No code, JSON, or CLI in the default UI.

## Status

Build is incremental (see the build order in the project brief). **Done so far:**

- **Step 1 — Block canvas (Scratch-style).** A category rail + scrollable block
  palette on the left, and a **blank canvas** on the right the user populates by
  dragging container blocks out and snapping typed sub-blocks into them.
  Containers are freely positioned and movable; sub-blocks reorder within.
  In-memory project document. Look & feel (cream/brown/burnt-orange, Montserrat +
  Source Serif 4) is mirrored from `../platform`'s "warm alpine" design system.
- **The IR.** Canonical, normalized environment representation (`toIR`) that the
  backend pipeline will compile, check, and deploy.

**Next:** IR persistence (save/load/fork) → pre-build "Check it" review →
compile pipeline (NL → HUD SDK code) → local validate → guided reward + golden
examples → deploy/train execution → practice/results view.

## Run it

```bash
npm run dev      # http://localhost:3000
npm run lint
npx tsc --noEmit
```

## Architecture

| Path | Role |
|------|------|
| `src/lib/blocks/model.ts` | Editor document, block registry, and the typing rules (which sub-block snaps into which container). The single source of truth for the UI. |
| `src/lib/ir/schema.ts` | Canonical IR (Zod) + `toIR(doc)` projection + reward-spec generation. Source of truth for the backend. |
| `src/state/project.tsx` | In-memory `ProjectDoc` (flat, freely-positioned `blocks[]`) via React context + reducer. |
| `src/components/builder/` | The dnd-kit canvas: `Builder` (DndContext), `Palette` (rail + tray), `PaletteItem`, `Canvas` (blank workspace), `Container`, `SubBlockCard`, reward/setting editors. |

### Container ↔ IR mapping

- **Helper** (purple) → `environment` (Goal, What goes in, What comes out)
- **Tool** (teal) → `tools[]` (name + What it does)
- **Challenge** (coral) → `tasks[]` (Question + Reward)
- **Practice** (pink) → `train` (Setting)

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · dnd-kit · Zod.
The LLM compile/check steps route to **claude-sonnet-4-6 through HUD's
OpenAI-compatible gateway**, so only the HUD API key is needed. The HUD docs MCP
server (`docs-hud`) is the SDK reference for code generation; the HUD CLI/platform
API is the execution layer — both stubbed behind clean interfaces until wired.
