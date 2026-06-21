// A lucide icon per block kind — the friendly itch-style type glyph shown in
// each block's header and palette chip.

import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Boxes,
  Brain,
  Flag,
  FileText,
  GraduationCap,
  Layers,
  ListChecks,
  MessageSquare,
  Paperclip,
  Repeat,
  Settings,
  Target,
  ThumbsDown,
  ThumbsUp,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { BlockKind } from "@/lib/blocks/model";

export const BLOCK_ICONS: Record<BlockKind, LucideIcon> = {
  // main
  environment: Boxes,
  tool: Wrench,
  taskset: Layers,
  train: GraduationCap,
  // group
  task: ListChecks,
  scoring: Target,
  // leaf
  overview: FileText,
  setup: Settings,
  goal: Flag,
  input: ArrowDownToLine,
  output: ArrowUpFromLine,
  reference: Paperclip,
  prompt: MessageSquare,
  good_outcome: ThumbsUp,
  bad_outcome: ThumbsDown,
  model: Brain,
  set_size: Repeat,
  improvement: GraduationCap,
};

// One re-export so improvement/set_size etc. resolve without extra imports.
export type { LucideIcon };
