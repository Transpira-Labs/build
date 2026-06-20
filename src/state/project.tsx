"use client";

// In-memory project state for the block canvas. The editor reads and writes one
// ProjectDoc through this reducer. Blocks live in a flat, freely-positioned list
// (Scratch-style canvas); persistence and the backend pipeline layer on top.

import {
  createContext,
  useContext,
  useMemo,
  useReducer,
  type Dispatch,
  type ReactNode,
} from "react";
import {
  CONTAINERS,
  emptyProject,
  firstOfKind,
  makeContainer,
  makeSubBlock,
  type ContainerInstance,
  type ContainerKind,
  type ProjectDoc,
  type RewardValue,
  type SettingValue,
  type SubKind,
} from "@/lib/blocks/model";

type Action =
  | { type: "load"; doc: ProjectDoc }
  | { type: "setName"; name: string }
  | { type: "placeContainer"; kind: ContainerKind; x: number; y: number }
  | { type: "moveContainer"; id: string; x: number; y: number }
  | { type: "bringToFront"; id: string }
  | { type: "removeContainer"; id: string }
  | { type: "renameContainer"; id: string; name: string }
  | { type: "addSubBlock"; containerId: string; subKind: SubKind }
  | { type: "removeSubBlock"; containerId: string; subId: string }
  | { type: "setText"; containerId: string; subId: string; text: string }
  | {
      type: "patchReward";
      containerId: string;
      subId: string;
      patch: Partial<RewardValue>;
    }
  | {
      type: "patchSetting";
      containerId: string;
      subId: string;
      patch: Partial<SettingValue>;
    }
  | { type: "reorderSub"; containerId: string; fromId: string; toId: string };

// --- helpers ---------------------------------------------------------------

function mapContainer(
  doc: ProjectDoc,
  id: string,
  fn: (c: ContainerInstance) => ContainerInstance,
): ProjectDoc {
  return { ...doc, blocks: doc.blocks.map((b) => (b.id === id ? fn(b) : b)) };
}

function mapSub(
  c: ContainerInstance,
  subId: string,
  fn: (b: ContainerInstance["subBlocks"][number]) => ContainerInstance["subBlocks"][number],
): ContainerInstance {
  return { ...c, subBlocks: c.subBlocks.map((b) => (b.id === subId ? fn(b) : b)) };
}

// --- reducer ---------------------------------------------------------------

function reducer(doc: ProjectDoc, action: Action): ProjectDoc {
  switch (action.type) {
    case "load":
      return action.doc;

    case "setName":
      return { ...doc, name: action.name };

    case "placeContainer": {
      // Singletons (Helper, Practice) may exist only once.
      if (CONTAINERS[action.kind].singleton && firstOfKind(doc, action.kind)) {
        return doc;
      }
      return {
        ...doc,
        blocks: [...doc.blocks, makeContainer(action.kind, action.x, action.y)],
      };
    }

    case "moveContainer":
      return mapContainer(doc, action.id, (c) => ({
        ...c,
        x: action.x,
        y: action.y,
      }));

    case "bringToFront": {
      const block = doc.blocks.find((b) => b.id === action.id);
      if (!block) return doc;
      return {
        ...doc,
        blocks: [...doc.blocks.filter((b) => b.id !== action.id), block],
      };
    }

    case "removeContainer":
      return { ...doc, blocks: doc.blocks.filter((b) => b.id !== action.id) };

    case "renameContainer":
      return mapContainer(doc, action.id, (c) => ({ ...c, name: action.name }));

    case "addSubBlock":
      return mapContainer(doc, action.containerId, (c) =>
        c.subBlocks.some((b) => b.kind === action.subKind)
          ? c // each sub-kind at most once per container
          : { ...c, subBlocks: [...c.subBlocks, makeSubBlock(action.subKind)] },
      );

    case "removeSubBlock":
      return mapContainer(doc, action.containerId, (c) => ({
        ...c,
        subBlocks: c.subBlocks.filter((b) => b.id !== action.subId),
      }));

    case "setText":
      return mapContainer(doc, action.containerId, (c) =>
        mapSub(c, action.subId, (b) => ({ ...b, text: action.text })),
      );

    case "patchReward":
      return mapContainer(doc, action.containerId, (c) =>
        mapSub(c, action.subId, (b) => ({
          ...b,
          reward: b.reward ? { ...b.reward, ...action.patch } : b.reward,
        })),
      );

    case "patchSetting":
      return mapContainer(doc, action.containerId, (c) =>
        mapSub(c, action.subId, (b) => ({
          ...b,
          setting: b.setting ? { ...b.setting, ...action.patch } : b.setting,
        })),
      );

    case "reorderSub":
      return mapContainer(doc, action.containerId, (c) => {
        const ids = c.subBlocks.map((b) => b.id);
        const from = ids.indexOf(action.fromId);
        const to = ids.indexOf(action.toId);
        if (from < 0 || to < 0 || from === to) return c;
        const next = [...c.subBlocks];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        return { ...c, subBlocks: next };
      });
  }
}

// --- context ---------------------------------------------------------------

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
    d ?? emptyProject(),
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
