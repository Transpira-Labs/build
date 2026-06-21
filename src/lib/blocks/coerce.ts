// Turn arbitrary parsed JSON into a valid ProjectDoc, or throw a readable error.
//
// Used by the right-panel JSON editor: the user types a ProjectDoc and we feed
// the result into the `load` action to rebuild the blocks. Missing ids and
// children are filled in so blocks can be written by hand without bookkeeping;
// unknown block kinds are rejected up front so a typo can't crash the canvas.

import { nanoid } from "nanoid";
import { BLOCKS, type Block, type BlockKind, type ProjectDoc } from "./model";

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function coerceBlock(input: unknown, path: string): Block {
  const rec = asRecord(input);
  if (!rec) throw new Error(`Expected a block object at ${path}`);

  const kind = rec.kind;
  if (typeof kind !== "string" || !(kind in BLOCKS)) {
    throw new Error(`Unknown block kind ${JSON.stringify(kind)} at ${path}`);
  }

  const children = Array.isArray(rec.children)
    ? rec.children.map((c, i) => coerceBlock(c, `${path}.children[${i}]`))
    : [];

  const block: Block = {
    id: typeof rec.id === "string" && rec.id ? rec.id : nanoid(8),
    kind: kind as BlockKind,
    children,
  };
  if (typeof rec.name === "string") block.name = rec.name;
  if (typeof rec.x === "number") block.x = rec.x;
  if (typeof rec.y === "number") block.y = rec.y;
  if (typeof rec.text === "string") block.text = rec.text;
  if (typeof rec.num === "number") block.num = rec.num;

  const ref = asRecord(rec.reference);
  if (ref) {
    block.reference = {
      mode: ref.mode === "upload" ? "upload" : "link",
      value: typeof ref.value === "string" ? ref.value : "",
    };
  }
  return block;
}

/** Parse-and-validate a ProjectDoc; `prev` supplies fallbacks for omitted top-level fields. */
export function coerceDoc(input: unknown, prev: ProjectDoc): ProjectDoc {
  const rec = asRecord(input);
  if (!rec) throw new Error("Top level must be a JSON object");
  if (!Array.isArray(rec.blocks)) throw new Error('"blocks" must be an array');

  const blocks = rec.blocks.map((b, i) => coerceBlock(b, `blocks[${i}]`));

  // Training is doc-level state. Carry it over leniently; a legacy "train" block
  // left in `blocks` is migrated into doc.train by normalizeDoc on load.
  const trainRec = asRecord(rec.train);
  const train = trainRec
    ? {
        model: typeof trainRec.model === "string" ? trainRec.model : prev.train.model,
        setSize:
          typeof trainRec.setSize === "number" ? trainRec.setSize : prev.train.setSize,
        improvement:
          typeof trainRec.improvement === "string"
            ? trainRec.improvement
            : prev.train.improvement,
      }
    : prev.train;

  const connections = asRecord(rec.connections);
  return {
    id: typeof rec.id === "string" && rec.id ? rec.id : prev.id,
    name: typeof rec.name === "string" ? rec.name : prev.name,
    version: typeof rec.version === "number" ? rec.version : prev.version,
    blocks,
    train,
    connections: connections
      ? (Object.fromEntries(
          Object.entries(connections).filter(([, v]) => typeof v === "string"),
        ) as Record<string, string>)
      : {},
  };
}
