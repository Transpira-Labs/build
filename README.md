# Environment Builder

A Scratch-style, block-based builder for **HUD** reinforcement-learning
environments. Snap together four kinds of blocks, describe each in plain
language, and get an environment you can build, test, and train on — no code,
JSON, or CLI in the default UI. Designed to live as a subdomain of the Transpira
platform, sharing its look and feel.

## Status

Build is incremental (see the build order in the project brief). **Done so far:**

- **Step 1 — Block canvas (Scratch-style, platform-native).** A scrollable block
  tray on the left (grouped by category) and a **blank canvas** on the right the
  user populates by dragging blocks out and snapping detail blocks into them.
  Blocks are freely positioned and movable; sub-blocks reorder within. In-memory
  project document. Styling mirrors `../platform`'s "warm alpine" system
  (cream / warm-brown / burnt-orange accent, Montserrat + Source Serif 4, flat
  bordered cards, no emoji, thin-stroke SVG icons).
- **The IR.** Canonical, normalized environment representation (`toIR`) that the
  backend pipeline will compile, check, and deploy.

**Next:** IR persistence (save/load/fork) → pre-build "Check it" review →
compile pipeline (NL → HUD SDK code) → local validate → reward/rubric checks →
deploy/train execution → practice/results view.

## Run it

```bash
npm run dev      # http://localhost:3000
npm run lint
npx tsc --noEmit
```

## Blocks (a recursive tree)

Blocks form a **recursive tree** and nest to any depth. Every block kind has a
`role`:

- **main** — the four top-level blocks placed on the canvas (Environment, Tool,
  Task, Train), freely positioned with x/y.
- **group** — a nestable container that holds other blocks. Today: **Scoring**
  (under Task), which holds Good/Bad answer blocks → so Task ▸ Scoring ▸ Good
  answer is two levels of nesting. New groups are just registry entries.
- **leaf** — holds a value (text / choice / number / reference).

`BLOCKS[kind].accepts` is the typing rule (which child kinds may snap in);
`isAllowed`/`canAdd` enforce it, `isRequired` marks defaults. Dropping a detail
block snaps it into the **nearest accepting ancestor** under the pointer
(`nearestAccepting`), so a Good answer lands in Scoring, a Goal in the Task.

**Defaults:** dragging a block out pre-includes its always-needed children
(`defaults`, recursively via `makeBlock`) — e.g. Task arrives with a Question and
a Scoring block already holding one Good and one Bad answer. Repeatable ones
(`many`) start with one; add more anytime.

**Palette:** collapsed by default to just the four main blocks; click the
chevron to reveal that block's detail blocks, indented by nesting depth
(`descendants`). Each main and group block carries a **"?" help popover**
explaining what it's for and what can go inside.

→ IR: Environment → `environment`; each Tool → `tools[]` (goal→description,
in→inputs, out→returns); each Task → `tasks[]` (prompt, references, good/bad →
`rubric`, plus optional per-task goal/in/out/format); Train → `train`
(`algorithm: "auto"` so an LLM picks the RL framework).

## Architecture

| Path | Role |
|------|------|
| `src/lib/blocks/model.ts` | Recursive `Block` tree, the `BLOCKS` registry, typing rules (`isAllowed`/`canAdd`/`nearestAccepting`), and pure tree ops (`mapBlock`, `findPath`, `removeFromForest`). Single source of truth for the UI. |
| `src/lib/ir/schema.ts` | Canonical IR (Zod) + `toIR(doc)` projection (walks the tree; rubric comes from the nested Scoring group). Source of truth for the backend. |
| `src/state/project.tsx` | In-memory `ProjectDoc` (recursive `blocks[]`) via React context + reducer over the tree. |
| `src/components/builder/` | The dnd-kit canvas: `Builder` (DndContext + nested-aware collision), `Palette` + `PaletteItem` (collapsible), `Canvas`, `MainBlock`, `BlockNode` (recursive group/leaf), `FieldEditor`, `HelpPopover`, `icons`. |

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · dnd-kit · Zod.
The LLM compile/check steps route to **claude-sonnet-4-6 through HUD's
OpenAI-compatible gateway**, so only the HUD API key is needed. The HUD docs MCP
server (`docs-hud`) is the SDK reference for code generation; the HUD CLI/platform
API is the execution layer — both stubbed behind clean interfaces until wired.
