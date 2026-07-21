import type { Message } from "./model";
import type { BranchToneKey } from "./branchTone";

export interface RenderedBranchAnchor {
  branchId: string;
  title: string;
  excerpt: string | null;
  range: { start: number; end: number } | null;
  tone?: BranchToneKey;
}

export interface RenderedMessage extends Message {
  renderedHtml: string;
  hasBranchHighlight: boolean;
  branchAnchors: RenderedBranchAnchor[];
}
