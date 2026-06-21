"use client";

// In-memory project state. The editor reads and writes one ProjectDoc through
// this reducer. Blocks form a recursive tree; top-level main blocks are freely
// positioned on the canvas.

import {
  createContext,
  useContext,
  useMemo,
  useReducer,
  type Dispatch,
  type ReactNode,
} from "react";
import {
  BLOCKS,
  canAdd,
  emptyProject,
  findAccepting,
  findBlock,
  firstMain,
  makeBlock,
  makeMain,
  mapBlock,
  normalizeDoc,
  removeFromForest,
  type Block,
  type BlockKind,
  type DeployInfo,
  type MainKind,
  type ProjectDoc,
  type ReferenceValue,
  type TrainRunInfo,
  type TrainSettings,
} from "@/lib/blocks/model";

type Action =
  | { type: "load"; doc: ProjectDoc }
  | { type: "setName"; name: string }
  | { type: "placeMain"; kind: MainKind; x: number; y: number }
  | {
      type: "placeChildInNewMain";
      mainKind: MainKind;
      childKind: BlockKind;
      x: number;
      y: number;
    }
  | { type: "moveMain"; id: string; x: number; y: number }
  | { type: "moveMany"; moves: { id: string; x: number; y: number }[] }
  | { type: "setWidth"; id: string; width: number }
  | { type: "setHeight"; id: string; height: number }
  | { type: "connect"; childId: string; parentId: string | null }
  | { type: "bringToFront"; id: string }
  | { type: "removeBlock"; id: string }
  | { type: "renameBlock"; id: string; name: string }
  | { type: "addChild"; parentId: string; kind: BlockKind }
  | { type: "setText"; id: string; text: string }
  | { type: "setNum"; id: string; num: number }
  | { type: "patchReference"; id: string; patch: Partial<ReferenceValue> }
  | { type: "setTrain"; patch: Partial<TrainSettings> }
  | { type: "setDeploy"; deploy: DeployInfo }
  | { type: "setTrainRun"; run: TrainRunInfo }
  | { type: "reorder"; parentId: string; fromId: string; toId: string };

function reducer(doc: ProjectDoc, action: Action): ProjectDoc {
  switch (action.type) {
    case "load":
      return normalizeDoc(action.doc);

    case "setName":
      return { ...doc, name: action.name };

    case "placeMain": {
      if (BLOCKS[action.kind].singleton && firstMain(doc, action.kind)) return doc;
      return {
        ...doc,
        blocks: [...doc.blocks, makeMain(action.kind, action.x, action.y)],
      };
    }

    // Drop a detail block that has no home: spawn (or reuse) the main block it
    // belongs to and tuck the detail into the right place inside it.
    case "placeChildInNewMain": {
      const existing = BLOCKS[action.mainKind].singleton
        ? firstMain(doc, action.mainKind)
        : undefined;
      const main = existing ?? makeMain(action.mainKind, action.x, action.y);
      const target = findAccepting(main, action.childKind);
      const nextMain = target
        ? mapBlock([main], target.id, (t) => ({
            ...t,
            children: [...t.children, makeBlock(action.childKind)],
          }))[0]
        : main;
      return {
        ...doc,
        blocks: existing
          ? mapBlock(doc.blocks, main.id, () => nextMain)
          : [...doc.blocks, nextMain],
      };
    }

    case "moveMain":
      return {
        ...doc,
        blocks: mapBlock(doc.blocks, action.id, (b) => ({
          ...b,
          x: action.x,
          y: action.y,
        })),
      };

    case "setWidth":
      return {
        ...doc,
        blocks: mapBlock(doc.blocks, action.id, (b) => ({ ...b, width: action.width })),
      };

    case "setHeight":
      return {
        ...doc,
        blocks: mapBlock(doc.blocks, action.id, (b) => ({ ...b, height: action.height })),
      };

    case "moveMany": {
      const by = new Map(action.moves.map((m) => [m.id, m]));
      return {
        ...doc,
        blocks: doc.blocks.map((b) => {
          const m = by.get(b.id);
          return m ? { ...b, x: m.x, y: m.y } : b;
        }),
      };
    }

    case "connect": {
      const connections = { ...(doc.connections ?? {}) };
      if (action.parentId) connections[action.childId] = action.parentId;
      else delete connections[action.childId];
      return { ...doc, connections };
    }

    case "bringToFront": {
      const block = doc.blocks.find((b) => b.id === action.id);
      if (!block) return doc;
      return {
        ...doc,
        blocks: [...doc.blocks.filter((b) => b.id !== action.id), block],
      };
    }

    case "removeBlock": {
      const connections = { ...(doc.connections ?? {}) };
      delete connections[action.id];
      for (const k of Object.keys(connections)) {
        if (connections[k] === action.id) delete connections[k];
      }
      return {
        ...doc,
        blocks: removeFromForest(doc.blocks, action.id),
        connections,
      };
    }

    case "renameBlock":
      return {
        ...doc,
        blocks: mapBlock(doc.blocks, action.id, (b) => ({ ...b, name: action.name })),
      };

    case "addChild":
      return {
        ...doc,
        blocks: mapBlock(doc.blocks, action.parentId, (p) =>
          canAdd(p, action.kind)
            ? { ...p, children: [...p.children, makeBlock(action.kind)] }
            : p,
        ),
      };

    case "setText":
      return {
        ...doc,
        blocks: mapBlock(doc.blocks, action.id, (b) => ({ ...b, text: action.text })),
      };

    case "setNum":
      return {
        ...doc,
        blocks: mapBlock(doc.blocks, action.id, (b) => ({ ...b, num: action.num })),
      };

    case "patchReference":
      return {
        ...doc,
        blocks: mapBlock(doc.blocks, action.id, (b) => ({
          ...b,
          reference: b.reference ? { ...b.reference, ...action.patch } : b.reference,
        })),
      };

    case "setTrain":
      return { ...doc, train: { ...doc.train, ...action.patch } };

    case "setDeploy":
      return { ...doc, deploy: action.deploy };

    case "setTrainRun":
      return { ...doc, lastTrain: action.run };

    case "reorder": {
      const parent = findBlock(doc.blocks, action.parentId);
      if (!parent) return doc;
      const ids = parent.children.map((c) => c.id);
      const from = ids.indexOf(action.fromId);
      const to = ids.indexOf(action.toId);
      if (from < 0 || to < 0 || from === to) return doc;
      return {
        ...doc,
        blocks: mapBlock(doc.blocks, action.parentId, (p) => {
          const next = [...p.children];
          const [moved] = next.splice(from, 1);
          next.splice(to, 0, moved);
          return { ...p, children: next };
        }),
      };
    }
  }
}

const ProjectContext = createContext<{
  doc: ProjectDoc;
  dispatch: Dispatch<Action>;
} | null>(null);

export function ProjectProvider({
  children,
  initial,
}: {
  children: ReactNode;
  initial?: ProjectDoc;
}) {
  const [doc, dispatch] = useReducer(reducer, initial ?? null, (d) =>
    d ? normalizeDoc(d) : emptyProject(),
  );
  const value = useMemo(() => ({ doc, dispatch }), [doc]);
  return (
    <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>
  );
}

export function useProject() {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error("useProject must be used inside <ProjectProvider>");
  return ctx;
}

// Re-export for convenience in components.
export type { Block };
