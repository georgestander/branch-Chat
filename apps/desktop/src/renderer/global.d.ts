import type { BranchyDesktopApi } from "../shared/contracts.ts";

declare global {
  interface Window {
    branchy: BranchyDesktopApi;
  }
}

export {};
