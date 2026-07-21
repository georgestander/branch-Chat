import type { Message } from "./model";

export interface RenderedBranchAnchor {
  branchId: string;
  title: string;
  excerpt: string | null;
  range: { start: number; end: number } | null;
}

export interface RenderedMessage extends Message {
  renderedHtml: string;
  hasBranchHighlight: boolean;
  branchAnchors: RenderedBranchAnchor[];
}
