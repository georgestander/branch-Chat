import type { Message } from "./model";

export interface RenderedMessage extends Message {
  renderedHtml: string;
  hasBranchHighlight: boolean;
}
